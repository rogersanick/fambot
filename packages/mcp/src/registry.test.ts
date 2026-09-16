import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, households, members, type Db } from "@fambot/database";
import { ProposedActionSchema } from "@fambot/shared";
import { createServices, type ExecutionContext, type Services } from "@fambot/domain";
import { allTools, toolByName } from "./tools";
import { runTool, toolInputJsonSchema } from "./server";
import type { ToolResult } from "./result";

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
    console.warn("[registry.test] local Postgres unavailable — skipping integration tests");
  }
  services = createServices(db);
});

async function fixture(role: "owner" | "member" = "owner") {
  const [household] = await db
    .insert(households)
    .values({ name: `test-${randomUUID().slice(0, 8)}`, timezone: "America/New_York" })
    .returning();
  const [member] = await db
    .insert(members)
    .values({ householdId: household!.id, displayName: "Tester", role })
    .returning();
  return { household: household!, member: member! };
}

function ctxFor(
  household: { id: string; timezone: string },
  member: { id: string; displayName: string },
  role: "owner" | "member" = "owner"
): ExecutionContext {
  return {
    db,
    services,
    householdId: household.id,
    timezone: household.timezone,
    actor: { memberId: member.id, householdId: household.id, role, displayName: member.displayName },
    conversation: null,
    participants: [{ id: member.id, displayName: member.displayName }],
    householdMembers: [{ id: member.id, displayName: member.displayName }],
  };
}

async function call(ctx: ExecutionContext, name: string, args: unknown): Promise<ToolResult> {
  const tool = toolByName.get(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return runTool(ctx, tool, args);
}

describe("tool registry contract", () => {
  test("covers every ProposedAction except clarify/chat_reply, plus reads", () => {
    const actionTypes = ProposedActionSchema.options.map(
      (option) => option.shape.type.value as string
    );
    const toolNames = new Set(allTools.map((t) => t.name));
    for (const type of actionTypes) {
      if (type === "clarify" || type === "chat_reply") {
        expect(toolNames.has(type)).toBe(false);
      } else {
        expect(toolNames.has(type)).toBe(true);
      }
    }
    for (const read of [
      "get_context",
      "list_members",
      "list_lists",
      "list_tasks",
      "list_reminders",
      "list_events",
      "get_notification_channels",
    ]) {
      expect(toolNames.has(read)).toBe(true);
    }
  });

  test("every tool has a description and a valid JSON schema; mutating tools expose idempotency_key", () => {
    for (const tool of allTools) {
      expect(tool.description.length).toBeGreaterThan(20);
      const schema = toolInputJsonSchema(tool);
      expect(schema.type).toBe("object");
      const properties = (schema.properties ?? {}) as Record<string, unknown>;
      // The internal discriminator must never leak into the tool contract.
      expect(properties.type).toBeUndefined();
      expect("idempotency_key" in properties).toBe(tool.mutating);
    }
  });

  test("invalid arguments return a structured failure, not a throw", async () => {
    const ctx = { householdId: randomUUID() } as ExecutionContext; // never reaches the db
    const result = await call(ctx, "create_list", { name: 42 });
    expect(result.status).toBe("failed");
    expect(result.message).toContain("Invalid arguments");
  });
});

describe("tool registry (integration)", () => {
  test("list lifecycle through tools: create, add items, read back", async () => {
    if (!available) return;
    const { household, member } = await fixture();
    const ctx = ctxFor(household, member);

    const created = await call(ctx, "create_list", {
      name: "groceries",
      items: ["milk"],
      task_ref: null,
      event_ref: null,
    });
    expect(created.status).toBe("executed");

    const added = await call(ctx, "add_list_items", { list_name: "grocer", items: ["eggs", "bread"] });
    expect(added.status).toBe("executed");

    const read = await call(ctx, "get_list", { list_name: "groceries" });
    expect(read.status).toBe("executed");
    expect(read.message).toContain("milk");
    expect(read.message).toContain("eggs");

    const listed = await call(ctx, "list_lists", {});
    expect((listed.data as Array<{ name: string }>).map((l) => l.name)).toContain("groceries");
  });

  test("idempotency_key: duplicate mutation replays the stored result", async () => {
    if (!available) return;
    const { household, member } = await fixture();
    const ctx = ctxFor(household, member);
    await call(ctx, "create_list", { name: "groceries", items: null, task_ref: null, event_ref: null });

    const key = randomUUID();
    const first = await call(ctx, "add_list_items", {
      list_name: "groceries",
      items: ["milk"],
      idempotency_key: key,
    });
    expect(first.status).toBe("executed");
    const second = await call(ctx, "add_list_items", {
      list_name: "groceries",
      items: ["milk"],
      idempotency_key: key,
    });
    expect(second).toEqual(first);

    const items = await services.lists.items(
      household.id,
      (first.data as { listId: string }).listId
    );
    expect(items.filter((i) => i.body === "milk").length).toBe(1);
  });

  test("household scoping: another household cannot see or touch the list", async () => {
    if (!available) return;
    const a = await fixture();
    const b = await fixture();
    await call(ctxFor(a.household, a.member), "create_list", {
      name: "groceries",
      items: null,
      task_ref: null,
      event_ref: null,
    });

    const read = await call(ctxFor(b.household, b.member), "get_list", { list_name: "groceries" });
    expect(read.status).toBe("clarify");
    expect(read.message).toContain("No list matches");
  });

  test("authorization: delete_list is owner-only", async () => {
    if (!available) return;
    const { household, member } = await fixture("member");
    const ctx = ctxFor(household, member, "member");
    await call(ctx, "create_list", { name: "secrets", items: null, task_ref: null, event_ref: null });

    const denied = await call(ctx, "delete_list", { name: "secrets" });
    expect(denied.status).toBe("rejected");
  });

  test("get_context reports household, actor, and local time", async () => {
    if (!available) return;
    const { household, member } = await fixture();
    const result = await call(ctxFor(household, member), "get_context", {});
    expect(result.status).toBe("executed");
    const data = result.data as {
      household: { id: string; timezone: string };
      actor: { displayName: string };
      nowLocal: string;
    };
    expect(data.household.id).toBe(household.id);
    expect(data.household.timezone).toBe("America/New_York");
    expect(data.actor.displayName).toBe("Tester");
    expect(data.nowLocal).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
  });

  test("nested create and link_* tools attach lists and reminders", async () => {
    if (!available) return;
    const { household, member } = await fixture();
    const ctx = ctxFor(household, member);

    await call(ctx, "create_list", {
      name: "packing",
      items: ["sunscreen"],
      task_ref: null,
      event_ref: null,
    });
    const task = await call(ctx, "create_task", {
      title: "Pack the car",
      due_at: null,
      rrule: null,
      assignee_name: null,
      checklist: null,
      list_ref: "packing",
      reminders: [{ fire_at: "2026-12-12T20:00:00", rrule: null }],
      event_ref: null,
    });
    expect(task.status).toBe("executed");
    const event = await call(ctx, "create_event", {
      title: "Beach trip",
      notes: null,
      start_at: "2026-12-13T10:00:00",
      end_at: null,
      location: null,
      attendee_names: null,
      rrule: null,
      list_ref: "packing",
      reminders: [{ fire_at: "2026-12-13T08:00:00", rrule: null }],
    });
    expect(event.status).toBe("executed");

    const lists = await services.lists.list(household.id);
    const packing = lists.find((l) => l.name === "packing");
    expect(packing?.taskId).toBe((task.data as { taskId: string }).taskId);
    expect(packing?.eventId).toBe((event.data as { eventId: string }).eventId);

    const reminder = await call(ctx, "create_reminder", {
      title: "Leave by 8",
      fire_at: "2026-12-13T07:30:00",
      rrule: null,
      task_ref: null,
      event_ref: null,
      until_completed: null,
      target: "sender",
      target_name: null,
    });
    expect(reminder.status).toBe("executed");
    const linked = await call(ctx, "link_reminder_to_event", {
      reminder_ref: "leave",
      event_ref: "beach",
    });
    expect(linked.status).toBe("executed");
    const [row] = await services.reminders.findByRef(household.id, "leave");
    expect(row!.eventId).toBe((event.data as { eventId: string }).eventId);
    expect(row!.taskId).toBeNull();
  });
});
