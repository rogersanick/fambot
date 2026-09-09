import { describe, expect, test } from "bun:test";
import { InboundRelay } from "./relay";
import { BridgeState } from "./state";
import type { BridgeConfig } from "./config";
import type { ImsgMessage } from "./imsg-rpc";

const config: BridgeConfig = {
  API_URL: "http://api.test",
  BRIDGE_TOKEN: "tok",
  IMSG_BIN: "imsg",
  BOT_MESSAGE_PREFIX: "Fambot says: 🤖✨",
  STATE_PATH: `/tmp/fambot-relay-test-${Date.now()}.json`,
  FAMBOT_PROFILE: "production",
};

function msg(overrides: Partial<ImsgMessage>): ImsgMessage {
  return {
    id: 1,
    chat_id: 1,
    chat_guid: "iMessage;+;chat1",
    guid: "g1",
    sender: "+15551234567",
    is_from_me: false,
    text: "hello",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function capture(responses: Array<number | Error> = [200]) {
  const calls: Array<{ url: string; body: unknown }> = [];
  let i = 0;
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    const r = responses[Math.min(i++, responses.length - 1)]!;
    if (r instanceof Error) throw r;
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response("{}", { status: r });
  }) as typeof fetch;
  return { calls, fetchFn };
}

const flush = () => new Promise((r) => setTimeout(r, 20));

describe("InboundRelay", () => {
  test("forwards inbound messages with auth and normalized payload", async () => {
    const { calls, fetchFn } = capture();
    const relay = new InboundRelay(config, new BridgeState(config.STATE_PATH), fetchFn);
    relay.handle(msg({ text: "@fambot remind me", chat_guid: "iMessage;+;chatX" }));
    await flush();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("http://api.test/api/ingest/imessage");
    expect(calls[0]!.body).toMatchObject({
      guid: "g1",
      chatGuid: "iMessage;+;chatX",
      text: "@fambot remind me",
      senderHandle: "+15551234567",
      isGroup: true,
    });
  });

  test("production profile drops all is_from_me messages", async () => {
    const { calls, fetchFn } = capture();
    const relay = new InboundRelay(config, new BridgeState(config.STATE_PATH), fetchFn);
    relay.handle(msg({ is_from_me: true, text: "my own message" }));
    await flush();
    expect(calls).toHaveLength(0);
  });

  test("local-dev forwards un-prefixed self messages but drops bot echoes", async () => {
    const { calls, fetchFn } = capture();
    const state = new BridgeState(config.STATE_PATH);
    const relay = new InboundRelay({ ...config, FAMBOT_PROFILE: "local-dev" }, state, fetchFn);
    relay.handle(msg({ is_from_me: true, guid: "self1", text: "remind me to stretch" }));
    relay.handle(msg({ is_from_me: true, guid: "echo1", text: "Fambot says: 🤖✨\nDone!" }));
    state.recordSent("ledger1");
    relay.handle(msg({ is_from_me: true, guid: "ledger1", text: "un-prefixed but in sent ledger" }));
    await flush();
    expect(calls).toHaveLength(1);
    expect((calls[0]!.body as { guid: string }).guid).toBe("self1");
  });

  test("skips empty texts and DMs are not groups", async () => {
    const { calls, fetchFn } = capture();
    const relay = new InboundRelay(config, new BridgeState(config.STATE_PATH), fetchFn);
    relay.handle(msg({ text: "   " }));
    relay.handle(msg({ chat_guid: "iMessage;-;+15551234567", text: "dm" }));
    await flush();
    expect(calls).toHaveLength(1);
    expect((calls[0]!.body as { isGroup: boolean }).isGroup).toBe(false);
  });

  test("retries 5xx with backoff", async () => {
    const { calls, fetchFn } = capture([500, 200]);
    const relay = new InboundRelay(config, new BridgeState(config.STATE_PATH), fetchFn);
    relay.handle(msg({}));
    await new Promise((r) => setTimeout(r, 1200)); // first backoff is 1s
    expect(calls).toHaveLength(2); // 500 attempt + successful retry, same payload
    expect(calls[0]!.body).toEqual(calls[1]!.body);
  });
});
