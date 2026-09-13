import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { households, members } from "@fambot/database";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolResult } from "@fambot/mcp";
import { db } from "./context";
import { mcpApp } from "./mcp";
import { mintMcpToken } from "./mcp-auth";

/**
 * Full HTTP round-trip: official MCP client → Streamable HTTP → Hono →
 * delegated auth → tool registry → Postgres. Skips when the local dev
 * Postgres is unavailable.
 */
let available = false;
let server: ReturnType<typeof Bun.serve> | null = null;
let baseUrl = "";

beforeAll(async () => {
  try {
    await db.execute("select 1" as never);
    available = true;
  } catch {
    console.warn("[mcp.test] local Postgres unavailable — skipping integration tests");
    return;
  }
  server = Bun.serve({ port: 0, fetch: mcpApp.fetch });
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
});

async function fixture() {
  const [household] = await db
    .insert(households)
    .values({ name: `test-${randomUUID().slice(0, 8)}`, timezone: "America/New_York" })
    .returning();
  const [member] = await db
    .insert(members)
    .values({ householdId: household!.id, displayName: "Tester", role: "owner" })
    .returning();
  return { household: household!, member: member! };
}

async function connect(token: string) {
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);
  return client;
}

function parseResult(raw: Awaited<ReturnType<Client["callTool"]>>): ToolResult {
  const content = raw.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0]!.text) as ToolResult;
}

describe("mcp http endpoint (integration)", () => {
  test("valid delegated token: initialize, list tools, call a tool", async () => {
    if (!available) return;
    const { household, member } = await fixture();
    const token = await mintMcpToken({
      memberId: member.id,
      householdId: household.id,
      conversationId: null,
      source: "agent",
      requestId: randomUUID(),
    });
    const client = await connect(token);

    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("create_list");
    expect(names).toContain("get_context");
    expect(names).not.toContain("clarify");
    expect(names).not.toContain("chat_reply");

    const created = parseResult(
      await client.callTool({ name: "create_list", arguments: { name: "camping", items: ["tent"] } })
    );
    expect(created.status).toBe("executed");

    const read = parseResult(
      await client.callTool({ name: "get_list", arguments: { list_name: "camping" } })
    );
    expect(read.message).toContain("tent");
    await client.close();
  });

  test("missing or garbage bearer token is rejected", async () => {
    if (!available) return;
    const noAuth = await fetch(`${baseUrl}/mcp`, { method: "POST", body: "{}" });
    expect(noAuth.status).toBe(401);
    const garbage = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: "Bearer not-a-jwt" },
      body: "{}",
    });
    expect(garbage.status).toBe(401);
  });

  test("cross-household claims are rejected even with a valid signature", async () => {
    if (!available) return;
    const a = await fixture();
    const b = await fixture();
    // Member from household A claiming household B: signature is fine, DB says no.
    const token = await mintMcpToken({
      memberId: a.member.id,
      householdId: b.household.id,
      conversationId: null,
      source: "agent",
      requestId: randomUUID(),
    });
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(403);
  });

  test("expired tokens are rejected", async () => {
    if (!available) return;
    const { household, member } = await fixture();
    const token = await mintMcpToken(
      {
        memberId: member.id,
        householdId: household.id,
        conversationId: null,
        source: "agent",
        requestId: randomUUID(),
      },
      -10 // already expired
    );
    const res = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });
});
