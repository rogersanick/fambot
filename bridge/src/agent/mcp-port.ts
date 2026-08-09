import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ToolPort, ToolSpec } from "./types.js";

/**
 * ToolPort backed by FamBot's MCP server over streamable HTTP, authenticated
 * with the agent user's Supabase JWT. One connection per agent run — the
 * server is stateless.
 */
export async function connectMcp(mcpUrl: string, token: string): Promise<ToolPort> {
  const client = new Client({ name: "fambot-bridge", version: "2.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  await client.connect(transport);

  return {
    async list(): Promise<ToolSpec[]> {
      const res = await client.listTools();
      return res.tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      }));
    },
    async call(name, args): Promise<string> {
      const res = await client.callTool({ name, arguments: args });
      const parts = Array.isArray(res.content) ? res.content : [];
      const text = parts
        .filter((p): p is { type: "text"; text: string } => p?.type === "text")
        .map((p) => p.text)
        .join("\n");
      return text || JSON.stringify(res);
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}
