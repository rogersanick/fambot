#!/usr/bin/env node
/**
 * Debug harness: plays a multi-turn conversation against the real agent
 * exactly the way the bridge does (same system prompt, same OpenAI loop,
 * same MCP port), without iMessage.
 *
 *   cd bridge && npx tsx ../scripts/agent-repl.mjs "msg 1" "msg 2" ...
 *
 * Each argument is one user message; the bot's replies are fed back into the
 * context, mirroring the bridge's context buffer. Reads bridge/.env.
 */
const { loadConfig } = await import("../bridge/src/config.ts");
const { AgentSession } = await import("../bridge/src/supabase-session.ts");
const { connectMcp } = await import("../bridge/src/agent/mcp-port.ts");
const { runOpenAiAgent } = await import("../bridge/src/agent/run-openai.ts");
const { SYSTEM_PROMPT, buildUserPrompt } = await import("../bridge/src/prompt.ts");

const messages = process.argv.slice(2);
if (messages.length === 0) messages.push("@fambot hey what's up");
const chatGuid = process.env.REPL_CHAT_GUID ?? "any;-;+15550009999";
const sender = process.env.REPL_SENDER ?? "+18028290933";

const config = loadConfig();
const session = new AgentSession(config.supabaseUrl, config.supabaseAnonKey, config.agentEmail, config.agentPassword);
await session.start();

const contextTurns = [];
let n = 0;
for (const text of messages) {
  const userTurn = {
    messageGuid: `debug-${++n}`,
    senderHandle: sender,
    senderName: null,
    text,
    sentAt: new Date().toISOString(),
    invokedBot: true,
    isFromMe: false,
    isBot: false,
  };
  contextTurns.push(userTurn);

  console.log(`\n>>> ${sender}: ${text}`);
  const started = Date.now();
  const tools = await connectMcp(config.mcpUrl, await session.token());
  try {
    const reply = await runOpenAiAgent(
      { system: SYSTEM_PROMPT, user: buildUserPrompt({ ...userTurn, chatGuid, contextTurns: [...contextTurns] }) },
      {
        baseUrl: config.openaiBaseUrl,
        model: config.openaiModel,
        apiKey: config.openaiApiKey || undefined,
        timeoutMs: config.agentTimeoutMs,
        tools,
      },
    );
    console.log(`<<< FamBot (${Date.now() - started}ms): ${reply}`);
    contextTurns.push({
      messageGuid: `debug-bot-${n}`,
      senderHandle: "__fambot__",
      senderName: "FamBot",
      text: reply,
      sentAt: new Date().toISOString(),
      invokedBot: false,
      isFromMe: true,
      isBot: true,
    });
  } catch (err) {
    console.error(`<<< FAILED (${Date.now() - started}ms): ${err instanceof Error ? err.message : err}`);
  }
}
session.stop();
