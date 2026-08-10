import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BridgeState } from "./state.js";
import { ContextBuffer } from "./context-buffer.js";
import { InvocationMatcher } from "./invocation.js";
import { createInboundHandler, FollowUpWindow, type Invocation } from "./inbound.js";
import type { BridgeConfig } from "./config.js";
import type { ImsgMessage } from "./imsg-rpc.js";

const CHAT = "iMessage;+;chat123";

function makeConfig(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    profile: "local-dev",
    imsgBin: "imsg",
    botName: "fambot",
    botMessagePrefix: "Fambot says: 🤖✨",
    statePath: join(mkdtempSync(join(tmpdir(), "fambot-test-")), "state.json"),
    supabaseUrl: "http://127.0.0.1:54321",
    supabaseAnonKey: "anon",
    agentEmail: "agent@fambot.local",
    agentPassword: "pw",
    mcpUrl: "http://localhost:3000/mcp",
    agentMode: "cli",
    agentCmd: "cat",
    agentTimeoutMs: 1000,
    openaiBaseUrl: "http://127.0.0.1:1337/v1",
    openaiModel: "test",
    openaiApiKey: "",
    reminderPollMs: 30_000,
    ...overrides,
  };
}

function setup(overrides: Partial<BridgeConfig> = {}) {
  const config = makeConfig(overrides);
  const state = new BridgeState(config.statePath);
  const followUps = new FollowUpWindow();
  const invocations: Invocation[] = [];
  const handler = createInboundHandler({
    config,
    state,
    contextBuffer: new ContextBuffer(),
    matcher: new InvocationMatcher(config.botName),
    followUps,
    onInvocation: (inv) => invocations.push(inv),
  });
  return { config, state, handler, followUps, invocations };
}

function msg(overrides: Partial<ImsgMessage>): ImsgMessage {
  return {
    id: 1,
    chat_id: 1,
    chat_guid: CHAT,
    guid: `guid-${Math.random()}`,
    sender: "+15551234567",
    is_from_me: false,
    text: "hello",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

test("a mention invokes from any chat — no allowlist", () => {
  const { handler, invocations } = setup();
  handler(msg({ chat_guid: "iMessage;+;never-seen-before", text: "@fambot help us get set up" }));
  handler(msg({ chat_guid: "iMessage;-;+15550001111", text: "@fambot hi" }));
  assert.equal(invocations.length, 2);
});

test("messages without text are dropped", () => {
  const { handler, invocations } = setup();
  handler(msg({ text: undefined }));
  handler(msg({ text: "   " }));
  assert.equal(invocations.length, 0);
});

test("untagged messages are buffered but do not invoke", () => {
  const { handler, invocations } = setup();
  handler(msg({ text: "who wants pizza tonight?" }));
  assert.equal(invocations.length, 0);
  handler(msg({ text: "@fambot add pizza night to the calendar" }));
  assert.equal(invocations.length, 1);
  // The earlier untagged turn rides along as context.
  assert.equal(invocations[0]!.contextTurns.length, 2);
  assert.equal(invocations[0]!.contextTurns[0]!.text, "who wants pizza tonight?");
});

test("tagged message produces an invocation with sender details", () => {
  const { handler, invocations } = setup();
  handler(msg({ text: "fambot what's on the list?", sender: "+15559990000", sender_name: "Dana" }));
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0]!.senderHandle, "+15559990000");
  assert.equal(invocations[0]!.senderName, "Dana");
  assert.equal(invocations[0]!.chatGuid, CHAT);
});

test("bot's own prefixed output never invokes but is kept as context", () => {
  const { handler, invocations } = setup();
  handler(msg({ is_from_me: true, text: "Fambot says: 🤖✨\nWhat should we call your household?" }));
  assert.equal(invocations.length, 0);

  // The next invocation carries the bot's question so multi-turn flows work.
  handler(msg({ text: "@fambot The Rogers" }));
  assert.equal(invocations.length, 1);
  const turns = invocations[0]!.contextTurns;
  assert.equal(turns.length, 2);
  assert.equal(turns[0]!.isBot, true);
  assert.equal(turns[0]!.senderName, "FamBot");
  assert.equal(turns[0]!.text, "What should we call your household?"); // prefix stripped
});

test("sent-ledger hit is dropped even without prefix", () => {
  const { handler, invocations, state } = setup();
  state.recordSent("known-guid");
  handler(msg({ is_from_me: true, guid: "known-guid", text: "@fambot echo" }));
  assert.equal(invocations.length, 0);
});

test("developer typing from own identity still invokes in local-dev", () => {
  const { handler, invocations } = setup();
  handler(msg({ is_from_me: true, text: "@fambot remind me to stretch at 5" }));
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0]!.senderHandle, "__me__");
});

test("production drops all is_from_me messages", () => {
  const { handler, invocations } = setup({ profile: "production" });
  handler(msg({ is_from_me: true, text: "@fambot hi" }));
  assert.equal(invocations.length, 0);
  handler(msg({ is_from_me: false, text: "@fambot hi" }));
  assert.equal(invocations.length, 1);
});

test("custom bot name matches alongside fambot", () => {
  const { handler, invocations } = setup({ botName: "jarvis" });
  handler(msg({ text: "hey @jarvis what's up" }));
  handler(msg({ text: "hey @fambot what's up" }));
  assert.equal(invocations.length, 2);
});

test("an open follow-up window lets the same sender continue without a mention", () => {
  const { handler, followUps, invocations } = setup();
  handler(msg({ text: "the rogers household please", sender: "+15551234567" }));
  assert.equal(invocations.length, 0); // no window yet, no mention

  followUps.open(CHAT, "+15551234567"); // bot replied to this sender
  handler(msg({ text: "The Rogers", sender: "+15551234567" }));
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0]!.text, "The Rogers");

  // One follow-up per bot reply: the window is consumed.
  handler(msg({ text: "also add grandma", sender: "+15551234567" }));
  assert.equal(invocations.length, 1);
});

test("follow-up window ignores other senders and expires", () => {
  const followUps = new FollowUpWindow(1_000);
  const now = Date.now();
  followUps.open(CHAT, "+15551234567", now);

  assert.equal(followUps.consume(CHAT, "+15559990000", now), false); // other sender
  assert.equal(followUps.consume(CHAT, "+15551234567", now + 2_000), false); // expired
  followUps.open(CHAT, "+15551234567", now);
  assert.equal(followUps.consume(CHAT, "+15551234567", now + 500), true); // in time
});

test("watch cursor persists across state reloads", () => {
  const { config, state } = setup();
  state.setCursor(42);
  const reloaded = new BridgeState(config.statePath);
  assert.equal(reloaded.getCursor(), 42);
});
