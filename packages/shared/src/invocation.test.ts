import { describe, expect, test } from "bun:test";
import { InvocationMatcher, shouldInvokeAssistant } from "./invocation";
import type { InboundMessage } from "./inbound-message";

describe("InvocationMatcher", () => {
  const m = new InvocationMatcher();

  test("matches @fambot case-insensitively with word bounds", () => {
    expect(m.matches("@fambot remind me")).toBe(true);
    expect(m.matches("hey @FamBot, help")).toBe(true);
    expect(m.matches("@fambots")).toBe(false);
    expect(m.matches("fambot without the at")).toBe(false);
    expect(m.matches("email@fambot.com")).toBe(false);
  });

  test("custom bot name adds an alias", () => {
    const custom = new InvocationMatcher("jeeves");
    expect(custom.matches("@jeeves do the thing")).toBe(true);
    expect(custom.matches("@fambot do the thing")).toBe(true);
  });

  test("strip removes the tag", () => {
    expect(m.strip("@fambot remind me at 5")).toBe("remind me at 5");
    expect(m.strip("hey @fambot, remind me")).toBe("hey remind me");
  });
});

describe("shouldInvokeAssistant", () => {
  const base: InboundMessage = {
    id: "x",
    channel: "imessage",
    conversationExternalId: "chat1",
    sender: { externalId: "+1555" },
    text: "hello",
    sentAt: new Date().toISOString(),
    context: { isGroup: true, botWasMentioned: false, isReplyToBot: false },
  };

  test("group without mention: silent", () => {
    expect(shouldInvokeAssistant(base)).toBe(false);
  });

  test("group with mention: invoke", () => {
    expect(
      shouldInvokeAssistant({ ...base, context: { ...base.context, botWasMentioned: true } })
    ).toBe(true);
  });

  test("DM always invokes", () => {
    expect(shouldInvokeAssistant({ ...base, context: { ...base.context, isGroup: false } })).toBe(true);
  });
});
