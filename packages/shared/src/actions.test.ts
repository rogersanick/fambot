import { describe, expect, test } from "bun:test";
import { InterpretationSchema, ProposedActionSchema } from "./actions";

describe("ProposedAction schemas", () => {
  test("valid create_reminder parses", () => {
    const r = ProposedActionSchema.safeParse({
      type: "create_reminder",
      title: "check the oven",
      fire_at: "2026-09-09T17:00:00",
      rrule: null,
      target: "sender",
      target_name: null,
    });
    expect(r.success).toBe(true);
  });

  test("rejects unknown action types", () => {
    expect(ProposedActionSchema.safeParse({ type: "rm_rf", path: "/" }).success).toBe(false);
  });

  test("rejects timezone-offset datetimes (model must stay in local wall clock)", () => {
    const r = ProposedActionSchema.safeParse({
      type: "create_reminder",
      title: "x",
      fire_at: "2026-09-09T17:00:00Z",
      rrule: null,
      target: "sender",
      target_name: null,
    });
    expect(r.success).toBe(false);
  });

  test("recurring task with rrule parses", () => {
    const r = ProposedActionSchema.safeParse({
      type: "create_task",
      title: "take out the trash",
      due_at: "2026-09-13T19:00:00",
      rrule: "FREQ=WEEKLY;BYDAY=SU",
      nag_interval_minutes: 30,
      assignee_name: null,
      list_name: null,
    });
    expect(r.success).toBe(true);
  });

  test("envelope caps at 5 actions", () => {
    const chat = { type: "chat_reply", text: "hi" };
    expect(InterpretationSchema.safeParse({ actions: Array(6).fill(chat) }).success).toBe(false);
    expect(InterpretationSchema.safeParse({ actions: [chat] }).success).toBe(true);
    expect(InterpretationSchema.safeParse({ actions: [] }).success).toBe(false);
  });
});
