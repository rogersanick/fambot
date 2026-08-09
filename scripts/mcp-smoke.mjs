#!/usr/bin/env node
/**
 * End-to-end MCP smoke test, exercising exactly what a real agent does:
 * sign in as the agent user, connect to the FamBot MCP server with the JWT,
 * then get_context → (setup_household if needed) → create_task → list_tasks
 * → create_reminder → list_reminders.
 *
 * Prereqs: `supabase start`, `node scripts/bootstrap-local.mjs`, web dev server.
 */
import { createClient } from "@supabase/supabase-js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const MCP_URL = process.env.MCP_URL ?? "http://localhost:3000/mcp";
const AGENT_EMAIL = process.env.AGENT_EMAIL ?? "agent@fambot.local";
const AGENT_PASSWORD = process.env.AGENT_PASSWORD ?? "fambot-agent";
const CHAT_GUID = process.env.CHAT_GUID ?? "iMessage;+;chat-smoke-test";

function parse(result) {
  const text = result.content?.find((p) => p.type === "text")?.text ?? "{}";
  return JSON.parse(text);
}

// 1. Sign in as the agent user (what the bridge does at startup).
const supabase = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
  email: AGENT_EMAIL,
  password: AGENT_PASSWORD,
});
if (authError) throw new Error(`agent sign-in failed: ${authError.message}`);
console.log(`✓ signed in as ${AGENT_EMAIL}`);

// 2. Connect to the MCP server with the JWT as bearer token.
const client = new Client({ name: "mcp-smoke", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${auth.session.access_token}` } },
  }),
);
const { tools } = await client.listTools();
console.log(`✓ connected to ${MCP_URL} — ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}`);

// 3. get_context, and set up a household if this chat has none.
let ctx = parse(await client.callTool({ name: "get_context", arguments: { chat_guid: CHAT_GUID } }));
let householdId = ctx.household_for_chat;
if (!householdId) {
  const setup = parse(
    await client.callTool({
      name: "setup_household",
      arguments: {
        name: "Smoke Test Household",
        timezone: "America/New_York",
        display_name: "FamBot",
        role: "agent",
        chat_guid: CHAT_GUID,
        chat_name: "smoke chat",
      },
    }),
  );
  if (setup.error) throw new Error(`setup_household: ${setup.error}`);
  householdId = setup.household_id;
  console.log(`✓ setup_household → ${householdId}`);
} else {
  console.log(`✓ get_context resolved chat → household ${householdId}`);
}

// 4. Create and list a task.
const task = parse(
  await client.callTool({
    name: "create_task",
    arguments: { household_id: householdId, title: `smoke task ${new Date().toISOString()}` },
  }),
);
if (task.error) throw new Error(`create_task: ${task.error}`);
console.log(`✓ create_task → ${task.id}`);

const tasks = parse(
  await client.callTool({ name: "list_tasks", arguments: { household_id: householdId } }),
);
if (!tasks.some?.((t) => t.id === task.id)) throw new Error("created task missing from list_tasks");
console.log(`✓ list_tasks → ${tasks.length} open task(s), including the new one`);

// 5. Create and list a reminder (fires in 1 minute, delivered to the chat).
const reminder = parse(
  await client.callTool({
    name: "create_reminder",
    arguments: {
      household_id: householdId,
      message: "smoke reminder",
      fire_at: new Date(Date.now() + 60_000).toISOString(),
    },
  }),
);
if (reminder.error) throw new Error(`create_reminder: ${reminder.error}`);
console.log(`✓ create_reminder → ${reminder.id} (delivery: ${reminder.delivery})`);

await client.close();
console.log("\nMCP smoke test passed.");
