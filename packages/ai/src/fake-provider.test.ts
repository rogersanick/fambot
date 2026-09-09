import { describe, expect, test } from "bun:test";
import { FakeAIProvider } from "./fake-provider";
import type { InterpretationInput } from "./types";

const base: InterpretationInput = {
  nowLocal: "2026-09-08T20:00:00",
  timezone: "America/New_York",
  senderName: "Nick",
  participantNames: ["Nick", "Jess"],
  isGroup: false,
  recentTurns: [],
  text: "",
};

async function interpret(text: string) {
  const { actions } = await new FakeAIProvider().interpret({ ...base, text });
  return actions;
}

describe("FakeAIProvider fixtures (plan §10)", () => {
  test('"Remind me tomorrow at 5 to call mom" → create_reminder', async () => {
    const [a] = await interpret("Remind me tomorrow at 5 to call mom");
    expect(a).toMatchObject({ type: "create_reminder", target: "sender" });
    if (a?.type === "create_reminder") {
      expect(a.fire_at).toBe("2026-09-09T17:00:00"); // bare "5" biases to evening
      expect(a.title.toLowerCase()).toContain("call mom");
    }
  });

  test('"Make sure the trash goes out tonight" → create_task', async () => {
    const [a] = await interpret("Make sure the trash goes out tonight");
    expect(a?.type).toBe("create_task");
    if (a?.type === "create_task") expect(a.due_at).toBe("2026-09-08T21:00:00");
  });

  test('"dinner Friday" → clarify', async () => {
    const [a] = await interpret("dinner Friday");
    expect(a?.type).toBe("clarify");
  });

  test('"done" after a nudge → complete_task with null ref', async () => {
    const [a] = await interpret("done");
    expect(a).toEqual({ type: "complete_task", task_ref: null });
  });

  test('"remind us every sunday at 7pm to take out the trash" → recurring conversation reminder', async () => {
    const [a] = await interpret("remind us every sunday at 7pm to take out the trash");
    expect(a).toMatchObject({
      type: "create_reminder",
      target: "conversation",
      rrule: "FREQ=WEEKLY;BYDAY=SU",
    });
  });

  test("schedule question → search_schedule", async () => {
    const [a] = await interpret("what's on this week?");
    expect(a?.type).toBe("search_schedule");
  });

  test("small talk → chat_reply", async () => {
    const [a] = await interpret("hello there");
    expect(a?.type).toBe("chat_reply");
  });
});
