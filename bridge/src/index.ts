import { loadConfig } from "./config.js";
import { BridgeState } from "./state.js";
import { ContextBuffer } from "./context-buffer.js";
import { InvocationMatcher } from "./invocation.js";
import { ImsgRpc } from "./imsg-rpc.js";
import { createInboundHandler, FollowUpWindow, type Invocation } from "./inbound.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
import { runCliAgent } from "./agent/run-cli.js";
import { runOpenAiAgent } from "./agent/run-openai.js";
import { connectMcp } from "./agent/mcp-port.js";
import { AgentSession } from "./supabase-session.js";
import { ReminderPoller } from "./reminders.js";
import type { AgentRequest } from "./agent/types.js";

const config = loadConfig();
const state = new BridgeState(config.statePath);
const contextBuffer = new ContextBuffer();
const matcher = new InvocationMatcher(config.botName);
const followUps = new FollowUpWindow();
const session = new AgentSession(
  config.supabaseUrl,
  config.supabaseAnonKey,
  config.agentEmail,
  config.agentPassword,
);

const rpc = new ImsgRpc({
  bin: config.imsgBin,
  onMessage: (message) => handleInbound(message),
  getCursor: () => state.getCursor(),
  setCursor: (rowid) => state.setCursor(rowid),
});

async function sendPrefixed(chatGuid: string, text: string): Promise<void> {
  const body = config.botMessagePrefix ? `${config.botMessagePrefix}\n${text}` : text;
  const result = await rpc.send({ chat_guid: chatGuid, text: body });
  state.recordSent(result.guid);
  // Record our own reply immediately so multi-turn flows (onboarding Q&A)
  // see both sides of the conversation even before the watch echo arrives.
  contextBuffer.add(chatGuid, {
    messageGuid: result.guid ?? `sent-${Date.now()}`,
    senderHandle: "__fambot__",
    senderName: "FamBot",
    text,
    sentAt: new Date().toISOString(),
    invokedBot: false,
    isFromMe: true,
    isBot: true,
  });
}

async function runAgent(request: AgentRequest): Promise<string> {
  const token = await session.token();
  if (config.agentMode === "cli") {
    // Ready-made MCP client config (Claude Code's --mcp-config accepts JSON).
    const mcpConfig = JSON.stringify({
      mcpServers: {
        fambot: {
          type: "http",
          url: config.mcpUrl,
          headers: { Authorization: `Bearer ${token}` },
        },
      },
    });
    return runCliAgent(request, {
      command: config.agentCmd,
      timeoutMs: config.agentTimeoutMs,
      env: { FAMBOT_MCP_URL: config.mcpUrl, FAMBOT_MCP_TOKEN: token, FAMBOT_MCP_CONFIG: mcpConfig },
    });
  }
  const tools = await connectMcp(config.mcpUrl, token);
  return runOpenAiAgent(request, {
    baseUrl: config.openaiBaseUrl,
    model: config.openaiModel,
    apiKey: config.openaiApiKey || undefined,
    timeoutMs: config.agentTimeoutMs,
    tools,
  });
}

// One agent run at a time per chat; runs in different chats may interleave.
const chatQueues = new Map<string, Promise<void>>();

function handleInvocation(invocation: Invocation): void {
  const prior = chatQueues.get(invocation.chatGuid) ?? Promise.resolve();
  const run = prior.then(async () => {
    const started = Date.now();
    console.log(`[agent] ${invocation.chatGuid}: "${invocation.text.slice(0, 80)}"`);
    try {
      const reply = await runAgent({ system: SYSTEM_PROMPT, user: buildUserPrompt(invocation) });
      await sendPrefixed(invocation.chatGuid, reply);
      // Let the sender answer a follow-up question without re-tagging the bot.
      followUps.open(invocation.chatGuid, invocation.senderHandle);
      console.log(`[agent] replied in ${Date.now() - started}ms: "${reply.slice(0, 160).replace(/\n/g, " ")}"`);
    } catch (err) {
      console.error("[agent] run failed:", err instanceof Error ? err.message : err);
      await sendPrefixed(invocation.chatGuid, "Sorry, I hit a snag handling that — try again?").catch(() => {});
    }
  });
  chatQueues.set(invocation.chatGuid, run);
}

const handleInbound = createInboundHandler({
  config,
  state,
  contextBuffer,
  matcher,
  followUps,
  onInvocation: handleInvocation,
});

const reminders = new ReminderPoller(session, sendPrefixed, config.reminderPollMs);
const sweepTimer = setInterval(() => contextBuffer.sweep(), 60_000);

async function main(): Promise<void> {
  console.log(`FamBot bridge (${config.profile}) starting`);
  console.log(`  imsg binary: ${config.imsgBin}`);
  console.log(`  MCP server: ${config.mcpUrl}`);
  console.log(`  Agent mode: ${config.agentMode}${config.agentMode === "openai" ? ` (${config.openaiBaseUrl}, model ${config.openaiModel})` : ` (${config.agentCmd})`}`);
  if (config.profile === "local-dev") {
    console.log(`  Bot prefix: ${config.botMessagePrefix}`);
  }

  await session.start();
  console.log(`  Signed in to Supabase as ${config.agentEmail}`);

  await rpc.start();

  // Readiness probe: proves chat.db is readable (Full Disk Access granted).
  try {
    const chats = await rpc.chatsList(1);
    console.log(`  imsg ready — ${chats.length > 0 ? "chat.db readable" : "no chats visible yet"}`);
  } catch (err) {
    console.error(
      "[startup] imsg is running but chats.list failed — check Full Disk Access:",
      err instanceof Error ? err.message : err,
    );
  }

  reminders.start();
  console.log("FamBot bridge is watching for messages.");
}

function shutdown(): void {
  console.log("\nShutting down…");
  reminders.stop();
  clearInterval(sweepTimer);
  session.stop();
  rpc.stop();
  setTimeout(() => process.exit(0), 500).unref();
  process.exitCode = 0;
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[startup] fatal:", message);
  if (message.includes("authorization denied")) {
    console.error(
      "\nimsg can't read ~/Library/Messages/chat.db from this process tree.\n" +
        "Grant Full Disk Access (System Settings → Privacy & Security → Full Disk Access)\n" +
        "to the terminal app you're running the bridge from — and to its parent launcher\n" +
        "(e.g. the IDE) if this is an embedded terminal — then restart that app and retry.\n" +
        "Verify with: imsg chats --limit 3",
    );
  }
  process.exit(1);
});
