import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, households, members, type Db } from "@fambot/database";
import { executeActions, type ExecutionContext } from "./executor";
import { createServices, type Services } from "./services";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:fambot@localhost:5433/fambot";

let db: Db;
let services: Services;
let available = false;

beforeAll(async () => {
  db = createDb(DATABASE_URL);
  try {
    await db.execute("select 1" as never);
    available = true;
  } catch {
    console.warn("[lists.test] local Postgres unavailable — skipping integration tests");
  }
  services = createServices(db);
});

async function fixture(): Promise<ExecutionContext> {
  const [household] = await db
    .insert(households)
    .values({ name: `lists-${randomUUID().slice(0, 8)}`, timezone: "America/New_York" })
    .returning();
  const [member] = await db
    .insert(members)
    .values({ householdId: household!.id, displayName: "Tester", role: "owner" })
    .returning();
  return {
    db,
    services,
    householdId: household!.id,
    timezone: household!.timezone,
    actor: {
      memberId: member!.id,
      householdId: household!.id,
      role: "owner",
      displayName: member!.displayName,
    },
    conversation: null,
    participants: [{ id: member!.id, displayName: member!.displayName }],
    householdMembers: [{ id: member!.id, displayName: member!.displayName }],
  };
}

describe("list item actions (integration)", () => {
  test("create, read, update, check, and delete list items without comments", async () => {
    if (!available) return;
    const ctx = await fixture();

    let outcome = await executeActions(ctx, [
      { type: "create_list", name: "groceries", items: ["milk", "eggs"], task_ref: null, event_ref: null },
    ]);
    expect(outcome.executions[0]!.status).toBe("executed");

    const list = await services.lists.findByName(ctx.householdId, "groceries");
    expect(list).not.toBeNull();
    expect((await services.lists.items(ctx.householdId, list!.id)).map((item) => item.body)).toEqual([
      "milk",
      "eggs",
    ]);

    await executeActions(ctx, [
      { type: "add_list_items", list_name: "groc", items: ["cheese"] },
      {
        type: "update_list_item",
        list_name: "groceries",
        item_ref: "cheese",
        new_title: "cheddar",
      },
      {
        type: "set_list_item_completed",
        list_name: "groceries",
        item_ref: "milk",
        completed: true,
      },
      { type: "delete_list_item", list_name: "groceries", item_ref: "eggs" },
    ]);

    outcome = await executeActions(ctx, [{ type: "get_list", list_name: "groc" }]);
    expect(outcome.reply).toContain("✓ milk");
    expect(outcome.reply).toContain("○ cheddar");
    expect(outcome.reply).not.toContain("eggs");
    expect(await services.comments.listBySubject(ctx.householdId, { type: "list", id: list!.id })).toEqual([]);
  });

  test("nested create_task makes a task-owned checklist, not extra tasks", async () => {
    if (!available) return;
    const ctx = await fixture();
    const outcome = await executeActions(ctx, [
      {
        type: "create_task",
        title: "Get spaghetti stuff",
        due_at: null,
        rrule: null,
        assignee_name: null,
        checklist: { title: "Spaghetti ingredients", items: ["spaghetti", "beef"] },
        list_ref: null,
        reminders: [{ fire_at: "2026-12-13T17:00:00", rrule: null }],
        event_ref: null,
      },
    ]);
    expect(outcome.executions[0]!.status).toBe("executed");
    const householdTasks = await services.tasks.list(ctx.householdId);
    expect(householdTasks.map((t) => t.title)).toEqual(["Get spaghetti stuff"]);
    const lists = await services.lists.list(ctx.householdId);
    expect(lists).toHaveLength(1);
    expect(lists[0]!.taskId).toBe(householdTasks[0]!.id);
    const items = await services.lists.items(ctx.householdId, lists[0]!.id);
    expect(items.map((i) => i.body)).toEqual(["spaghetti", "beef"]);
    const reminders = await services.reminders.list(ctx.householdId);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.taskId).toBe(householdTasks[0]!.id);
  });

  test("standing household lists stay task-free", async () => {
    if (!available) return;
    const ctx = await fixture();
    await executeActions(ctx, [
      { type: "create_list", name: "baby boho", items: null, task_ref: null, event_ref: null },
      { type: "add_list_items", list_name: "baby boho", items: ["baby pants"] },
    ]);
    const lists = await services.lists.list(ctx.householdId);
    expect(lists).toHaveLength(1);
    expect(lists[0]!.taskId).toBeNull();
    expect((await services.lists.items(ctx.householdId, lists[0]!.id)).map((i) => i.body)).toEqual(["baby pants"]);
    expect(await services.tasks.list(ctx.householdId)).toEqual([]);
    expect(await services.reminders.list(ctx.householdId)).toEqual([]);
  });

  test("create_reminder without a parent infers a task", async () => {
    if (!available) return;
    const ctx = await fixture();
    const outcome = await executeActions(ctx, [
      {
        type: "create_reminder",
        title: "Get spaghetti stuff",
        fire_at: "2026-12-13T17:00:00",
        rrule: null,
        task_ref: null,
        event_ref: null,
        until_completed: null,
        target: "sender",
        target_name: null,
      },
    ]);
    expect(outcome.executions[0]!.status).toBe("executed");
    const householdTasks = await services.tasks.list(ctx.householdId);
    expect(householdTasks.map((t) => t.title)).toEqual(["Get spaghetti stuff"]);
    const reminders = await services.reminders.list(ctx.householdId);
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.taskId).toBe(householdTasks[0]!.id);
    expect(reminders[0]!.eventId).toBeNull();
  });

  test("repeating reminder on an open task is until-completed", async () => {
    if (!available) return;
    const ctx = await fixture();
    await executeActions(ctx, [
      {
        type: "create_task",
        title: "Take the trash out",
        due_at: null,
        rrule: null,
        assignee_name: null,
        checklist: null,
        list_ref: null,
        reminders: null,
        event_ref: null,
      },
    ]);
    const outcome = await executeActions(ctx, [
      {
        type: "create_reminder",
        title: "Take the trash out",
        fire_at: "2026-12-13T17:00:00",
        rrule: "FREQ=HOURLY;INTERVAL=4",
        task_ref: "trash",
        event_ref: null,
        until_completed: null,
        target: "sender",
        target_name: null,
      },
    ]);
    expect(outcome.executions[0]!.status).toBe("executed");
    const [task] = await services.tasks.list(ctx.householdId);
    const [reminder] = await services.reminders.list(ctx.householdId);
    expect(reminder!.taskId).toBe(task!.id);
    expect(reminder!.untilCompleted).toBe(true);
    await services.tasks.complete(task!.id);
    const [stopped] = await services.reminders.list(ctx.householdId);
    expect(stopped!.status).toBe("cancelled");
  });

  test("link_task_to_event attaches an open task to an event", async () => {
    if (!available) return;
    const ctx = await fixture();
    await executeActions(ctx, [
      {
        type: "create_event",
        title: "Dentist",
        notes: null,
        start_at: "2026-12-13T14:00:00",
        end_at: null,
        location: null,
        attendee_names: null,
        rrule: null,
        list_ref: null,
        reminders: null,
      },
      {
        type: "create_task",
        title: "Complete dentist paperwork",
        due_at: null,
        rrule: null,
        assignee_name: null,
        checklist: null,
        list_ref: null,
        reminders: null,
        event_ref: null,
      },
      { type: "link_task_to_event", task_ref: "paperwork", event_ref: "dentist" },
    ]);
    const [event] = await services.events.findByRef(ctx.householdId, "dentist");
    const [task] = await services.tasks.list(ctx.householdId);
    expect(task!.eventId).toBe(event!.id);
  });

  test("REST reminder may omit a parent; both parents are rejected", async () => {
    if (!available) return;
    const ctx = await fixture();
    const fireAt = new Date("2026-12-13T17:00:00.000Z");
    const oneOff = await services.reminders.create({
      householdId: ctx.householdId,
      creatorMemberId: ctx.actor.memberId,
      title: "Call grandma",
      fireAt,
      rrule: null,
      timezone: ctx.timezone,
      targetType: "member",
      targetMemberId: ctx.actor.memberId,
    });
    expect(oneOff.taskId).toBeNull();
    expect(oneOff.eventId).toBeNull();
    expect(oneOff.untilCompleted).toBe(false);

    const task = await services.tasks.create({
      householdId: ctx.householdId,
      creatorMemberId: ctx.actor.memberId,
      title: "Paperwork",
      dueAt: null,
      timezone: ctx.timezone,
    });
    const event = await services.events.create({
      householdId: ctx.householdId,
      creatorMemberId: ctx.actor.memberId,
      title: "Dentist",
      startsAt: new Date("2026-12-13T14:00:00.000Z"),
      timezone: ctx.timezone,
    });
    await expect(
      services.reminders.create({
        householdId: ctx.householdId,
        creatorMemberId: ctx.actor.memberId,
        title: "Both parents",
        taskId: task.id,
        eventId: event.id,
        fireAt,
        rrule: null,
        timezone: ctx.timezone,
        targetType: "member",
        targetMemberId: ctx.actor.memberId,
      })
    ).rejects.toThrow("both");
  });

  test("a list can attach to a task and an event independently", async () => {
    if (!available) return;
    const ctx = await fixture();
    const task = await services.tasks.create({
      householdId: ctx.householdId,
      creatorMemberId: ctx.actor.memberId,
      title: "Pack the car",
      dueAt: null,
      timezone: ctx.timezone,
    });
    const event = await services.events.create({
      householdId: ctx.householdId,
      creatorMemberId: ctx.actor.memberId,
      title: "Beach trip",
      startsAt: new Date("2026-12-13T10:00:00.000Z"),
      timezone: ctx.timezone,
    });
    const list = await services.lists.create(ctx.householdId, "packing", ctx.actor.memberId, task.id, event.id);
    expect(list.taskId).toBe(task.id);
    expect(list.eventId).toBe(event.id);
    const updated = await services.lists.update(ctx.householdId, list.id, { taskId: null });
    expect(updated!.taskId).toBeNull();
    expect(updated!.eventId).toBe(event.id);
  });

  test("nested create_task list_ref and create_event list_ref + reminders attach in one shot", async () => {
    if (!available) return;
    const ctx = await fixture();
    await executeActions(ctx, [
      {
        type: "create_list",
        name: "packing",
        items: ["sunscreen"],
        task_ref: null,
        event_ref: null,
      },
    ]);
    const nested = await executeActions(ctx, [
      {
        type: "create_task",
        title: "Pack the car",
        due_at: null,
        rrule: null,
        assignee_name: null,
        checklist: null,
        list_ref: "packing",
        reminders: [{ fire_at: "2026-12-12T20:00:00", rrule: null }],
        event_ref: null,
      },
      {
        type: "create_event",
        title: "Beach trip",
        notes: "Leave extra time for traffic.",
        start_at: "2026-12-13T10:00:00",
        end_at: null,
        location: null,
        attendee_names: null,
        rrule: null,
        list_ref: "packing",
        reminders: [{ fire_at: "2026-12-13T08:00:00", rrule: null }],
      },
    ]);
    expect(nested.executions.every((e) => e.status === "executed")).toBe(true);
    const [task] = await services.tasks.list(ctx.householdId);
    const [event] = await services.events.findByRef(ctx.householdId, "beach");
    const packing = await services.lists.findByName(ctx.householdId, "packing");
    expect(packing!.taskId).toBe(task!.id);
    expect(packing!.eventId).toBe(event!.id);
    expect(event!.notes).toBe("Leave extra time for traffic.");
    const reminders = await services.reminders.list(ctx.householdId);
    expect(reminders).toHaveLength(2);
    expect(reminders.some((r) => r.taskId === task!.id)).toBe(true);
    expect(reminders.some((r) => r.eventId === event!.id)).toBe(true);
  });

  test("link_* actions attach existing lists and reminders", async () => {
    if (!available) return;
    const ctx = await fixture();
    await executeActions(ctx, [
      {
        type: "create_list",
        name: "baby boho",
        items: ["onesies"],
        task_ref: null,
        event_ref: null,
      },
      {
        type: "create_task",
        title: "Pack the car",
        due_at: null,
        rrule: null,
        assignee_name: null,
        checklist: null,
        list_ref: null,
        reminders: null,
        event_ref: null,
      },
      {
        type: "create_event",
        title: "Beach trip",
        notes: null,
        start_at: "2026-12-13T10:00:00",
        end_at: null,
        location: null,
        attendee_names: null,
        rrule: null,
        list_ref: null,
        reminders: null,
      },
      {
        type: "create_reminder",
        title: "Leave by 8",
        fire_at: "2026-12-13T08:00:00",
        rrule: null,
        task_ref: "pack",
        event_ref: null,
        until_completed: null,
        target: "sender",
        target_name: null,
      },
    ]);
    const linked = await executeActions(ctx, [
      { type: "link_list_to_task", list_name: "boho", task_ref: "pack" },
      { type: "link_list_to_event", list_name: "boho", event_ref: "beach" },
      { type: "link_reminder_to_event", reminder_ref: "leave", event_ref: "beach" },
    ]);
    expect(linked.executions.every((e) => e.status === "executed")).toBe(true);
    const [task] = await services.tasks.list(ctx.householdId);
    const [event] = await services.events.findByRef(ctx.householdId, "beach");
    const list = await services.lists.findByName(ctx.householdId, "baby boho");
    const [reminder] = await services.reminders.list(ctx.householdId);
    expect(list!.taskId).toBe(task!.id);
    expect(list!.eventId).toBe(event!.id);
    expect(reminder!.eventId).toBe(event!.id);
    expect(reminder!.taskId).toBeNull();

    await executeActions(ctx, [{ type: "link_reminder_to_task", reminder_ref: "leave", task_ref: "pack" }]);
    const [reparented] = await services.reminders.list(ctx.householdId);
    expect(reparented!.taskId).toBe(task!.id);
    expect(reparented!.eventId).toBeNull();
  });
});
