import { describe, expect, test } from "bun:test";
import { parseParentValue, parentValue, eventLinks, listEventLinkPatches, listLinks, reminderChipLabel, reminderChipWhen, reminderLinks, taskLinks, withoutReminders } from "./artifact-links";
import type { EventRow, ListRow, ReminderRow, TaskRow } from "./types";

describe("artifact parent values", () => {
  test("round-trips task and event ids", () => {
    expect(parseParentValue(parentValue("task-1", null))).toEqual({ taskId: "task-1", eventId: null });
    expect(parseParentValue(parentValue(null, "event-1"))).toEqual({ taskId: null, eventId: "event-1" });
    expect(parseParentValue(parentValue(null, null))).toEqual({ taskId: null, eventId: null });
    expect(parseParentValue("")).toEqual({ taskId: null, eventId: null });
  });
});

describe("shared link helpers", () => {
  const task: TaskRow = {
    id: "t1",
    title: "Pack the car",
    status: "open",
    due_at: null,
    completed_at: null,
    event_id: "e1",
    assignee: null,
    series_id: null,
    recurrence: null,
  };
  const event: EventRow = {
    id: "e1",
    title: "Beach trip",
    starts_at: "2026-09-20T10:00:00.000Z",
    ends_at: null,
    location: null,
    notes: "Bring sunscreen and the cooler.",
    recurrence: null,
  };
  const list: ListRow = {
    id: "l1",
    name: "Packing",
    task_id: "t1",
    event_id: "e1",
    items: [],
  };
  const reminder: ReminderRow = {
    id: "r1",
    message: "Leave by 8",
    fire_at: "2026-09-20T08:00:00.000Z",
    status: "pending",
    recurring: false,
    until_completed: false,
    parent: { type: "event", id: "e1", title: "Beach trip" },
  };

  test("taskLinks includes event, list, and reminder", () => {
    const ctx = { lists: [list], events: [event], reminders: [reminder], tz: "UTC" };
    expect(taskLinks(task, ctx)).toEqual([
      { type: "event", id: "e1", title: "Beach trip" },
      { type: "list", id: "l1", title: "Packing" },
    ]);
    const taskReminder: ReminderRow = {
      ...reminder,
      parent: { type: "task", id: "t1", title: "Pack the car" },
    };
    expect(taskLinks(task, { ...ctx, reminders: [taskReminder] })).toEqual([
      { type: "event", id: "e1", title: "Beach trip" },
      { type: "list", id: "l1", title: "Packing" },
      { type: "reminder", id: "r1", title: "Leave by 8", when: reminderChipWhen(taskReminder.fire_at, "UTC") },
    ]);
  });

  test("eventLinks includes task, list, and reminder with fire time instead of the event title", () => {
    expect(eventLinks(event, { tasks: [task], lists: [list], reminders: [reminder], tz: "UTC" })).toEqual([
      { type: "task", id: "t1", title: "Pack the car" },
      { type: "list", id: "l1", title: "Packing" },
      { type: "reminder", id: "r1", title: "Leave by 8", when: "8:00 AM" },
    ]);
    const titledLikeEvent: ReminderRow = { ...reminder, message: "Beach trip" };
    expect(eventLinks(event, { tasks: [], lists: [], reminders: [titledLikeEvent], tz: "UTC" })).toEqual([
      { type: "reminder", id: "r1", title: "", when: "8:00 AM" },
    ]);
  });

  test("reminderChipWhen uses clock time on the parent day and a dated label otherwise", () => {
    expect(reminderChipWhen("2026-09-20T08:00:00.000Z", "UTC", "2026-09-20T10:00:00.000Z")).toBe("8:00 AM");
    expect(reminderChipWhen("2026-09-19T20:00:00.000Z", "UTC", "2026-09-20T10:00:00.000Z")).toBe(
      reminderChipWhen("2026-09-19T20:00:00.000Z", "UTC")
    );
    expect(reminderChipLabel("8:00 AM", ["sms"])).toBe("Reminder at 8:00 AM via SMS");
    expect(reminderChipLabel("8:00 AM", ["sms", "imessage"])).toBe("Reminder at 8:00 AM via SMS and iMessage");
  });

  test("withoutReminders keeps tasks, events, and lists for schedule views", () => {
    const links = eventLinks(event, { tasks: [task], lists: [list], reminders: [reminder], tz: "UTC" });
    expect(withoutReminders(links)).toEqual([
      { type: "task", id: "t1", title: "Pack the car" },
      { type: "list", id: "l1", title: "Packing" },
    ]);
  });

  test("listLinks includes task and event", () => {
    expect(listLinks(list, { tasks: [task], events: [event] })).toEqual([
      { type: "task", id: "t1", title: "Pack the car" },
      { type: "event", id: "e1", title: "Beach trip" },
    ]);
  });

  test("reminderLinks is empty for one-offs", () => {
    expect(reminderLinks({ ...reminder, parent: null })).toEqual([]);
    expect(reminderLinks(reminder)).toEqual([{ type: "event", id: "e1", title: "Beach trip" }]);
  });

  test("listEventLinkPatches unlinks the previous list then attaches the next", () => {
    expect(listEventLinkPatches("e1", "l1", "l2")).toEqual([
      { listId: "l1", eventId: null },
      { listId: "l2", eventId: "e1" },
    ]);
    expect(listEventLinkPatches("e1", "l1", "")).toEqual([{ listId: "l1", eventId: null }]);
    expect(listEventLinkPatches("e1", null, "l2")).toEqual([{ listId: "l2", eventId: "e1" }]);
    expect(listEventLinkPatches("e1", "l1", "l1")).toEqual([]);
  });
});
