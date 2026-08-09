#!/usr/bin/env node
/**
 * Stand-in for the `imsg` binary (invoked as `fake-imsg.mjs rpc`) so the whole
 * bridge → agent → MCP → reply loop can be exercised without Messages.app.
 *
 * Speaks JSON-RPC 2.0, one object per line, on stdin/stdout. After the bridge
 * subscribes, it emits one scripted inbound message (FAKE_TEXT / FAKE_CHAT),
 * then echoes any `send` to stderr so you can see the bot's reply.
 */
import { createInterface } from "node:readline";

const CHAT = process.env.FAKE_CHAT ?? "iMessage;+;chat-smoke-test";
const TEXT = process.env.FAKE_TEXT ?? "@fambot add milk to the shopping list";
let nextRowId = 1000;

function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function notifyMessage(text, overrides = {}) {
  const message = {
    id: nextRowId++,
    chat_id: 1,
    chat_guid: CHAT,
    guid: `fake-${nextRowId}`,
    sender: "+15551234567",
    sender_name: "Test Sender",
    is_from_me: false,
    text,
    created_at: new Date().toISOString(),
    ...overrides,
  };
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "message", params: { message } }) + "\n");
}

createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const frame = JSON.parse(line);
  switch (frame.method) {
    case "watch.subscribe":
      reply(frame.id, {});
      setTimeout(() => {
        console.error(`[fake-imsg] delivering inbound: "${TEXT}"`);
        notifyMessage(TEXT);
      }, 300);
      break;
    case "chats.list":
      reply(frame.id, {
        chats: [{ id: 1, guid: CHAT, name: "Fake chat", is_group: true, participants: ["+15551234567"] }],
      });
      break;
    case "send": {
      const { chat_guid, text } = frame.params ?? {};
      console.error(`[fake-imsg] SEND to ${chat_guid}:\n${text}\n`);
      reply(frame.id, { ok: true, guid: `sent-${nextRowId++}` });
      break;
    }
    default:
      reply(frame.id, {});
  }
});
