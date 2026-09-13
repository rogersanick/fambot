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

  test("update_task distinguishes occurrence delay from series recurrence changes", () => {
    // Postpone one occurrence only.
    expect(
      ProposedActionSchema.safeParse({
        type: "update_task",
        task_ref: "trash",
        new_title: null,
        new_due_at: "2026-09-14T19:00:00",
        new_list_name: null,
        new_rrule: null,
        new_nag_interval_minutes: null,
        stop_recurrence: null,
      }).success
    ).toBe(true);
    // Change the whole series' recurrence + nag cadence.
    expect(
      ProposedActionSchema.safeParse({
        type: "update_task",
        task_ref: "trash",
        new_title: null,
        new_due_at: null,
        new_list_name: null,
        new_rrule: "FREQ=WEEKLY;BYDAY=MO",
        new_nag_interval_minutes: 60,
        stop_recurrence: null,
      }).success
    ).toBe(true);
    // Stop future occurrences.
    expect(
      ProposedActionSchema.safeParse({
        type: "update_task",
        task_ref: "trash",
        new_title: null,
        new_due_at: null,
        new_list_name: null,
        new_rrule: null,
        new_nag_interval_minutes: null,
        stop_recurrence: true,
      }).success
    ).toBe(true);
  });

  test("nag interval is bounded (5 min to 24 h)", () => {
    const make = (mins: number) => ({
      type: "update_task",
      task_ref: "trash",
      new_title: null,
      new_due_at: null,
      new_list_name: null,
      new_rrule: null,
      new_nag_interval_minutes: mins,
      stop_recurrence: null,
    });
    expect(ProposedActionSchema.safeParse(make(5)).success).toBe(true);
    expect(ProposedActionSchema.safeParse(make(1440)).success).toBe(true);
    expect(ProposedActionSchema.safeParse(make(4)).success).toBe(false);
    expect(ProposedActionSchema.safeParse(make(1441)).success).toBe(false);
  });

  test("cancel_task can target the whole series", () => {
    expect(
      ProposedActionSchema.safeParse({
        type: "cancel_task",
        task_ref: "trash",
        cancel_series: true,
      }).success
    ).toBe(true);
  });

  test("list CRUD actions parse", () => {
    const actions = [
      { type: "create_list", name: "groceries", items: ["milk", "eggs"] },
      { type: "add_list_items", list_name: "groceries", items: ["cheese"] },
      { type: "update_list_item", list_name: "groceries", item_ref: "cheese", new_title: "cheddar" },
      { type: "set_list_item_completed", list_name: "groceries", item_ref: "milk", completed: true },
      { type: "delete_list_item", list_name: "groceries", item_ref: "eggs" },
      { type: "get_list", list_name: "groceries" },
    ];
    for (const action of actions) {
      expect(ProposedActionSchema.safeParse(action).success).toBe(true);
    }
  });

  test("recurring create_event parses", () => {
    const r = ProposedActionSchema.safeParse({
      type: "create_event",
      title: "soccer practice",
      start_at: "2026-09-10T17:00:00",
      end_at: "2026-09-10T18:00:00",
      location: null,
      attendee_names: null,
      rrule: "FREQ=WEEKLY;BYDAY=TH;UNTIL=20261215T235959",
    });
    expect(r.success).toBe(true);
  });

  test("add_comment parses for task/event/list subjects only", () => {
    const make = (subject_type: string) => ({
      type: "add_comment",
      subject_type,
      subject_ref: "birthday cake",
      text: "ordered, pickup Saturday at noon",
    });
    expect(ProposedActionSchema.safeParse(make("task")).success).toBe(true);
    expect(ProposedActionSchema.safeParse(make("event")).success).toBe(true);
    expect(ProposedActionSchema.safeParse(make("list")).success).toBe(true);
    // Reminders are fire-and-forget — no comment threads.
    expect(ProposedActionSchema.safeParse(make("reminder")).success).toBe(false);
  });

  test("add_comment requires a non-empty ref and text", () => {
    expect(
      ProposedActionSchema.safeParse({
        type: "add_comment",
        subject_type: "task",
        subject_ref: "",
        text: "hello",
      }).success
    ).toBe(false);
    expect(
      ProposedActionSchema.safeParse({
        type: "add_comment",
        subject_type: "task",
        subject_ref: "cake",
        text: "",
      }).success
    ).toBe(false);
  });

  test("get_comment_status parses and rejects unknown subjects", () => {
    expect(
      ProposedActionSchema.safeParse({
        type: "get_comment_status",
        subject_type: "list",
        subject_ref: "groceries",
      }).success
    ).toBe(true);
    expect(
      ProposedActionSchema.safeParse({
        type: "get_comment_status",
        subject_type: "conversation",
        subject_ref: "groceries",
      }).success
    ).toBe(false);
  });

  test("envelope caps at 5 actions", () => {
    const chat = { type: "chat_reply", text: "hi" };
    expect(InterpretationSchema.safeParse({ actions: Array(6).fill(chat) }).success).toBe(false);
    expect(InterpretationSchema.safeParse({ actions: [chat] }).success).toBe(true);
    expect(InterpretationSchema.safeParse({ actions: [] }).success).toBe(false);
  });
});
