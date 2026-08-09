import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Spool } from "./spool.js";
import { ContextBuffer } from "./context-buffer.js";
import { InvocationMatcher } from "./invocation.js";
import { createInboundHandler, normalizeHandle } from "./inbound.js";
import type { BridgeConfig } from "./config.js";
import type { ImsgRpc, ImsgMessage } from "./imsg-rpc.js";
import type { IngestPayload } from "./fambot-api.js";

const CHAT = "iMessage;+;chat-test";

function makeConfig(overrides?: Partial<BridgeConfig>): BridgeConfig {
  return {
    profile: "local-dev",
    imsgBin: "imsg",
    functionsUrl: "http://127.0.0.1:54321/functions/v1",
    bridgeId: "00000000-0000-0000-0000-000000000001",
    bridgeSecret: "secret",
    chatAllowlist: new Set([CHAT]),
    botMessagePrefix: "Fambot says: 🤖✨",
    spoolPath: "unused",
    workerVersion: "test",
    ...overrides,
  };
}

interface Harness {
  handle: (m: ImsgMessage) => void;
  spool: Spool;
  contextBuffer: ContextBuffer;
  spooledCount: () => number;
  cleanup: () => void;
}

function makeHarness(config = makeConfig()): Harness {
  const dir = mkdtempSync(join(tmpdir(), "fambot-inbound-test-"));
  const spool = new Spool(join(dir, "spool.sqlite"));
  const contextBuffer = new ContextBuffer();
  const matcher = new InvocationMatcher();
  let spooled = 0;
  // The only mock in the repo outside imsg-rpc tests: a fake rpc whose
  // chats.list returns a fixed roster.
  const rpc = {
    chatsList: async () => [{ id: 1, guid: CHAT, participants: ["+15551234567", "+15559876543"] }],
  } as unknown as ImsgRpc;

  const handle = createInboundHandler({
    config,
    spool,
    contextBuffer,
    matcher,
    rpc,
    onInvocationSpooled: () => spooled++,
  });

  return {
    handle,
    spool,
    contextBuffer,
    spooledCount: () => spooled,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function msg(overrides: Partial<ImsgMessage>): ImsgMessage {
  return {
    id: 1,
    chat_id: 1,
    chat_guid: CHAT,
    guid: `guid-${Math.random().toString(36).slice(2)}`,
    sender: "+15551234567",
    sender_name: "Nick",
    is_from_me: false,
    text: "hello",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

async function until(cond: () => boolean, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
}

function pendingPayload(spool: Spool): IngestPayload {
  const row = spool.nextPending();
  assert.ok(row, "expected a spooled payload");
  return JSON.parse(row.payload) as IngestPayload;
}

test("normalizeHandle lowercases and defaults to __me__", () => {
  assert.equal(normalizeHandle(" +1555ABC "), "+1555abc");
  assert.equal(normalizeHandle(undefined), "__me__");
  assert.equal(normalizeHandle(""), "__me__");
});

test("tagged message is spooled with mapped fields and roster", async () => {
  const h = makeHarness();
  h.handle(msg({ guid: "m1", text: "@fambot add milk", sender: "+15551234567" }));
  await until(() => h.spooledCount() === 1);

  const payload = pendingPayload(h.spool);
  assert.equal(payload.message_guid, "m1");
  assert.equal(payload.chat_guid, CHAT);
  assert.equal(payload.sender_handle, "+15551234567");
  assert.equal(payload.sender_name, "Nick");
  assert.equal(payload.message_text, "@fambot add milk");
  assert.equal(payload.is_from_me, false);
  assert.deepEqual(payload.chat_participants, [
    { address: "+15551234567", displayName: null },
    { address: "+15559876543", displayName: null },
  ]);
  h.cleanup();
});

test("untagged messages are buffered as context but never spooled", async () => {
  const h = makeHarness();
  h.handle(msg({ guid: "u1", text: "can you get cucumbers?", sender: "+15559876543", sender_name: "Jess" }));
  assert.equal(h.spooledCount(), 0);
  assert.equal(h.spool.nextPending(), undefined);

  // The follow-up invocation carries the untagged turn as context.
  h.handle(msg({ guid: "u2", text: "Yes, @fambot", sender: "+15551234567" }));
  await until(() => h.spooledCount() === 1);
  const payload = pendingPayload(h.spool);
  assert.equal(payload.context_turns.length, 2);
  assert.equal(payload.context_turns[0]!.text, "can you get cucumbers?");
  assert.equal(payload.context_turns[0]!.invokedBot, false);
  assert.equal(payload.context_turns[1]!.invokedBot, true);
  h.cleanup();
});

test("non-allowlisted chats are ignored entirely in local-dev", () => {
  const h = makeHarness();
  h.handle(msg({ chat_guid: "iMessage;+;other-chat", text: "@fambot hi" }));
  assert.equal(h.spooledCount(), 0);
  // Not even buffered: a later tagged message in the allowlisted chat sees one turn.
  h.handle(msg({ text: "@fambot hi" }));
  const turns = h.contextBuffer.select(CHAT);
  assert.equal(turns.length, 1);
  h.cleanup();
});

test("self-messages: bot output dropped by prefix or ledger, developer typing passes", async () => {
  const h = makeHarness();

  // Bot's own reply echoed back through the watch stream.
  h.handle(msg({ guid: "bot1", is_from_me: true, sender: "", text: "Fambot says: 🤖✨\n✓ Added" }));
  assert.equal(h.contextBuffer.select(CHAT).length, 0);

  // A send whose guid landed in the ledger (production has no prefix).
  h.spool.recordSent("bot2", CHAT);
  h.handle(msg({ guid: "bot2", is_from_me: true, sender: "", text: "some reply" }));
  assert.equal(h.contextBuffer.select(CHAT).length, 0);

  // Developer typing from the shared identity is processed.
  h.handle(msg({ guid: "dev1", is_from_me: true, sender: "", text: "@fambot add eggs" }));
  await until(() => h.spooledCount() === 1);
  const payload = pendingPayload(h.spool);
  assert.equal(payload.sender_handle, "__me__");
  assert.equal(payload.is_from_me, true);
  h.cleanup();
});

test("production profile drops all is_from_me messages", () => {
  const h = makeHarness(makeConfig({ profile: "production" }));
  h.handle(msg({ is_from_me: true, sender: "", text: "@fambot add eggs" }));
  assert.equal(h.spooledCount(), 0);
  assert.equal(h.contextBuffer.select(CHAT).length, 0);
  h.cleanup();
});

test("rows without text (attachments, reactions, polls) are dropped", () => {
  const h = makeHarness();
  h.handle(msg({ text: "" }));
  h.handle(msg({ text: undefined }));
  h.handle(msg({ text: "   " }));
  assert.equal(h.contextBuffer.select(CHAT).length, 0);
  h.cleanup();
});
