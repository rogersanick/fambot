import { describe, expect, test } from "bun:test";
import {
  TELNYX_UNREACHABLE_MESSAGE,
  TelnyxSmsChannel,
  isTelnyxUnreachable,
  wrapTelnyxNetworkError,
} from "./telnyx";

/** Unit tests for the Telnyx adapter over a mocked fetch (no DB needed for sendSms). */

function makeChannel(handler: (url: string, init: RequestInit) => Response) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const channel = new TelnyxSmsChannel(null as never, {
    apiKey: "key-123",
    fromNumber: "+15550001111",
    messagingProfileId: "profile-9",
    fetchFn: (async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return handler(String(url), init!);
    }) as unknown as typeof fetch,
  });
  return { channel, calls };
}

describe("TelnyxSmsChannel.sendSms", () => {
  test("posts the message and returns the provider id; response means queued, not delivered", async () => {
    const { channel, calls } = makeChannel(
      () => new Response(JSON.stringify({ data: { id: "msg_abc" } }), { status: 200 })
    );
    const result = await channel.sendSms({ to: "+15557654321", text: "⏰ Reminder: one-shot" });
    expect(result.providerMessageId).toBe("msg_abc");

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.telnyx.com/v2/messages");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer key-123");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body).toEqual({
      from: "+15550001111",
      to: "+15557654321",
      text: "⏰ Reminder: one-shot",
      type: "SMS",
      messaging_profile_id: "profile-9",
    });
  });

  test("non-2xx responses throw with status and body excerpt", async () => {
    const { channel } = makeChannel(
      () => new Response(JSON.stringify({ errors: [{ detail: "invalid to number" }] }), { status: 422 })
    );
    await expect(channel.sendSms({ to: "bad", text: "x" })).rejects.toThrow(/telnyx send failed \(422\)/);
  });

  test("network failures become a Telnyx-unreachable error", async () => {
    const { channel } = makeChannel(() => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("connect ECONNREFUSED"), { name: "Error" }),
      });
    });
    await expect(channel.sendSms({ to: "+15557654321", text: "x" })).rejects.toThrow(
      TELNYX_UNREACHABLE_MESSAGE
    );
  });

  test("omits messaging_profile_id when not configured", async () => {
    const calls: Array<{ init: RequestInit }> = [];
    const channel = new TelnyxSmsChannel(null as never, {
      apiKey: "k",
      fromNumber: "+15550001111",
      fetchFn: (async (_url: unknown, init?: RequestInit) => {
        calls.push({ init: init! });
        return new Response(JSON.stringify({ data: { id: "m1" } }), { status: 200 });
      }) as unknown as typeof fetch,
    });
    await channel.sendSms({ to: "+15557654321", text: "hi" });
    const body = JSON.parse(String(calls[0]!.init.body));
    expect("messaging_profile_id" in body).toBe(false);
  });
});

describe("TelnyxSmsChannel.sendGroupMms", () => {
  test("posts a native group MMS with all recipients", async () => {
    const { channel, calls } = makeChannel(
      () =>
        new Response(
          JSON.stringify({ data: { id: "msg_group", group_message_id: "group_1" } }),
          { status: 200 }
        )
    );
    const result = await channel.sendGroupMms({
      to: ["+15557654321", "+15559876543"],
      text: "Dinner is at 6",
    });
    expect(result).toEqual({ providerMessageId: "msg_group", groupMessageId: "group_1" });
    expect(calls[0]!.url).toBe("https://api.telnyx.com/v2/messages/group_mms");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      from: "+15550001111",
      to: ["+15557654321", "+15559876543"],
      text: "Dinner is at 6",
    });
  });

  test("rejects unsupported recipient sets before calling Telnyx", async () => {
    const { channel, calls } = makeChannel(() => new Response("{}", { status: 200 }));
    await expect(
      channel.sendGroupMms({ to: ["+15557654321"], text: "x" })
    ).rejects.toThrow(/at least two/);
    await expect(
      channel.sendGroupMms({ to: ["+442071838750", "+15557654321"], text: "x" })
    ).rejects.toThrow(/US and Canadian/);
    expect(calls).toHaveLength(0);
  });

  test("network failures become a Telnyx-unreachable error", async () => {
    const { channel } = makeChannel(() => {
      throw new TypeError("fetch failed");
    });
    await expect(
      channel.sendGroupMms({ to: ["+15557654321", "+15559876543"], text: "x" })
    ).rejects.toThrow(TELNYX_UNREACHABLE_MESSAGE);
  });
});

describe("Telnyx reachability helpers", () => {
  test("classifies timeouts and DNS failures as unreachable", () => {
    expect(isTelnyxUnreachable(Object.assign(new Error("aborted"), { name: "TimeoutError" }))).toBe(
      true
    );
    expect(isTelnyxUnreachable(new TypeError("fetch failed"))).toBe(true);
    expect(isTelnyxUnreachable(new Error("getaddrinfo ENOTFOUND api.telnyx.com"))).toBe(true);
    expect(isTelnyxUnreachable(new Error("telnyx send failed (422): invalid to"))).toBe(false);
    expect(wrapTelnyxNetworkError(new TypeError("fetch failed")).message).toBe(
      TELNYX_UNREACHABLE_MESSAGE
    );
  });
});
