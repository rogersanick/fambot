import { test } from "node:test";
import assert from "node:assert/strict";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
import type { Invocation } from "./inbound.js";

function makeInvocation(overrides: Partial<Invocation> = {}): Invocation {
  return {
    chatGuid: "iMessage;+;chat-1",
    messageGuid: "m1",
    senderHandle: "+18025551234",
    senderName: "Jess",
    text: "@fambot add milk",
    sentAt: "2026-08-10T09:00:00Z",
    contextTurns: [],
    ...overrides,
  };
}

test("system prompt establishes FamBot as distinct from the device owner", () => {
  const lower = SYSTEM_PROMPT.toLowerCase();
  assert.match(lower, /not the device owner/);
  assert.match(lower, /appear to come from/);
});

test("chat participants render with known names and unknowns flagged", () => {
  const prompt = buildUserPrompt(makeInvocation(), [
    { handle: "+18025551234", name: "Jess" },
    { handle: "+15551230000", name: null },
  ]);
  assert.match(prompt, /Chat participants.*\+18025551234 \(Jess\), \+15551230000 \(name unknown\)/);
});

test("no participants line when lookup was unavailable", () => {
  const prompt = buildUserPrompt(makeInvocation(), null);
  assert.doesNotMatch(prompt, /Chat participants/);
});

test("the device owner's messages are labeled as a human, not the bot", () => {
  const prompt = buildUserPrompt(
    makeInvocation({
      senderHandle: "__me__",
      senderName: null,
      contextTurns: [
        {
          messageGuid: "m0",
          senderHandle: "__me__",
          senderName: null,
          text: "@fambot hello",
          sentAt: "2026-08-10T08:59:00Z",
          invokedBot: true,
          isFromMe: true,
          isBot: false,
        },
        {
          messageGuid: "m0b",
          senderHandle: "__fambot__",
          senderName: "FamBot",
          text: "Hi!",
          sentAt: "2026-08-10T08:59:30Z",
          invokedBot: false,
          isFromMe: true,
          isBot: true,
        },
      ],
    }),
  );
  assert.match(prompt, /device owner \(a human/i);
  assert.match(prompt, /FamBot \(you\)/);
  assert.doesNotMatch(prompt, /\bme \(device owner\)/);
});
