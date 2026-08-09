#!/usr/bin/env node
/**
 * Minimal CLI agent honoring the bridge's contract: prompt on stdin,
 * FAMBOT_MCP_URL + FAMBOT_MCP_TOKEN in env, reply on stdout. Instead of an
 * LLM it deterministically calls MCP tools: get_context for the chat, then
 * creates a task from the message text. Useful for verifying the pipeline
 * without any model.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const prompt = await new Promise((resolve) => {
  let data = "";
  process.stdin.on("data", (c) => (data += c));
  process.stdin.on("end", () => resolve(data));
});

const chatGuid = prompt.match(/^Chat GUID: (.+)$/m)?.[1]?.trim();
const message = prompt.match(/^The message to respond to: (.+)$/m)?.[1]?.trim() ?? "";
if (!chatGuid) {
  console.log("I couldn't tell which chat this came from.");
  process.exit(0);
}

const client = new Client({ name: "fake-agent", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(process.env.FAMBOT_MCP_URL), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.FAMBOT_MCP_TOKEN}` } },
  }),
);
const parse = (r) => JSON.parse(r.content?.find((p) => p.type === "text")?.text ?? "{}");

const ctx = parse(await client.callTool({ name: "get_context", arguments: { chat_guid: chatGuid } }));
const householdId = ctx.household_for_chat;
if (!householdId) {
  await client.close();
  console.log("This chat isn't set up yet — say '@fambot set up our household' first.");
  process.exit(0);
}

const title = message.replace(/@?fambot/i, "").replace(/^[\s,:-]+/, "").trim() || "untitled task";
const task = parse(
  await client.callTool({ name: "create_task", arguments: { household_id: householdId, title } }),
);
await client.close();

console.log(task.error ? `Hit an error: ${task.error}` : `Done — added "${title}" to the list ✓`);
