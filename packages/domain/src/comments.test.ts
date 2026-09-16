import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, events, households, lists, members, tasks, type Db } from "@fambot/database";
import { createServices, type Services } from "./services";
import { executeActions, type ExecutionContext } from "./executor";

/**
 * Integration tests against the local Postgres (same instance dev uses).
 * Each test creates its own household so runs are isolated.
 */
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
    console.warn("[comments.test] local Postgres unavailable — skipping integration tests");
  }
  services = createServices(db);
});

async function fixture() {
  const [household] = await db
    .insert(households)
    .values({ name: `test-${randomUUID().slice(0, 8)}`, timezone: "America/New_York" })
    .returning();
  const [member] = await db
    .insert(members)
    .values({ householdId: household!.id, displayName: "Tester", role: "owner" })
    .returning();
  return { household: household!, member: member! };
}

function ctxFor(household: { id: string; timezone: string }, member: { id: string; displayName: string }): ExecutionContext {
  return {
    db,
    services,
    householdId: household.id,
    timezone: household.timezone,
    actor: { memberId: member.id, householdId: household.id, role: "owner", displayName: member.displayName },
    conversation: null,
    participants: [{ id: member.id, displayName: member.displayName }],
    householdMembers: [{ id: member.id, displayName: member.displayName }],
  };
}

describe("comment service (integration)", () => {
  test("add + list returns newest-first with author names", async () => {
    if (!available) return;
    const { household, member } = await fixture();
    const [task] = await db
      .insert(tasks)
      .values({ householdId: household.id, title: "order the cake", status: "open" })
      .returning();
    const subject = { type: "task" as const, id: task!.id };

    const first = await services.comments.add({
      householdId: household.id,
      subject,
      authorMemberId: member.id,
      body: "called the bakery",
    });
    expect(first).not.toBeNull();
    // Ensure a strictly later timestamp for deterministic ordering.
    await new Promise((r) => setTimeout(r, 10));
    await services.comments.add({
      householdId: household.id,
      subject,
      authorMemberId: member.id,
      body: "ordered — pickup Saturday",
    });

    const thread = await services.comments.listBySubject(household.id, subject);
    expect(thread).not.toBeNull();
    expect(thread!.map((c) => c.body)).toEqual(["ordered — pickup Saturday", "called the bakery"]);
    expect(thread![0]!.authorName).toBe("Tester");
  });

  test("comments attach to events and lists too", async () => {
    if (!available) return;
    const { household, member } = await fixture();
    const [event] = await db
      .insert(events)
      .values({ householdId: household.id, title: "recital", startsAt: new Date() })
      .returning();
    const [list] = await db
      .insert(lists)
      .values({ householdId: household.id, name: "groceries" })
      .returning();

    for (const subject of [
      { type: "event" as const, id: event!.id },
      { type: "list" as const, id: list!.id },
    ]) {
      const added = await services.comments.add({
        householdId: household.id,
        subject,
        authorMemberId: member.id,
        body: `note on ${subject.type}`,
      });
      expect(added).not.toBeNull();
      const thread = await services.comments.listBySubject(household.id, subject);
      expect(thread!.length).toBe(1);
    }
  });

  test("cross-household subjects are invisible (add and list return null)", async () => {
    if (!available) return;
    const a = await fixture();
    const b = await fixture();
    const [task] = await db
      .insert(tasks)
      .values({ householdId: a.household.id, title: "private task", status: "open" })
      .returning();
    const subject = { type: "task" as const, id: task!.id };

    expect(
      await services.comments.add({
        householdId: b.household.id,
        subject,
        authorMemberId: b.member.id,
        body: "should not land",
      })
    ).toBeNull();
    expect(await services.comments.listBySubject(b.household.id, subject)).toBeNull();
    // And the real household still has an empty, readable thread.
    expect(await services.comments.listBySubject(a.household.id, subject)).toEqual([]);
  });

  test("missing subject returns null", async () => {
    if (!available) return;
    const { household } = await fixture();
    expect(
      await services.comments.listBySubject(household.id, { type: "task", id: randomUUID() })
    ).toBeNull();
  });
});

describe("executor comment actions (integration)", () => {
  test("add_comment resolves the task by ref and persists", async () => {
    if (!available) return;
    const { household, member } = await fixture();
    await db
      .insert(tasks)
      .values({ householdId: household.id, title: "order the birthday cake", status: "open" })
      .returning();

    const outcome = await executeActions(ctxFor(household, member), [
      { type: "add_comment", subject_type: "task", subject_ref: "birthday cake", text: "ordered it" },
    ]);
    expect(outcome.executions[0]!.status).toBe("executed");
    expect(outcome.reply).toContain('Noted on "order the birthday cake"');

    const [task] = await services.tasks.findByRef(household.id, "birthday cake");
    const thread = await services.comments.listBySubject(household.id, { type: "task", id: task!.id });
    expect(thread!.map((c) => c.body)).toEqual(["ordered it"]);
    expect(thread![0]!.authorMemberId).toBe(member.id);
  });

  test("get_comment_status: empty thread, verbatim fallback, and summarizer", async () => {
    if (!available) return;
    const { household, member } = await fixture();
    const [list] = await db
      .insert(lists)
      .values({ householdId: household.id, name: "party planning" })
      .returning();
    const ctx = ctxFor(household, member);
    const action = { type: "get_comment_status", subject_type: "list", subject_ref: "party planning" } as const;

    // Empty thread → deterministic "no updates" (no AI call).
    let outcome = await executeActions(ctx, [action]);
    expect(outcome.reply).toContain('No updates on "party planning" yet.');

    await services.comments.add({
      householdId: household.id,
      subject: { type: "list", id: list!.id },
      authorMemberId: member.id,
      body: "balloons are bought",
    });

    // No summarizer → verbatim rendering of the thread.
    outcome = await executeActions(ctx, [action]);
    expect(outcome.reply).toContain("balloons are bought");
    expect(outcome.reply).toContain("Tester");

    // Summarizer present → its text becomes the reply; it gets oldest-first comments.
    let received: string[] = [];
    outcome = await executeActions(
      {
        ...ctx,
        summarizeStatus: async ({ comments }) => {
          received = comments.map((c) => c.body);
          return "All set: balloons bought.";
        },
      },
      [action]
    );
    expect(outcome.reply).toBe("All set: balloons bought.");
    expect(received).toEqual(["balloons are bought"]);

    // Summarizer failure → falls back to verbatim, never throws.
    outcome = await executeActions(
      { ...ctx, summarizeStatus: async () => Promise.reject(new Error("model down")) },
      [action]
    );
    expect(outcome.executions[0]!.status).toBe("executed");
    expect(outcome.reply).toContain("balloons are bought");
  });

  test("unknown and ambiguous refs ask for clarification", async () => {
    if (!available) return;
    const { household, member } = await fixture();
    const ctx = ctxFor(household, member);

    let outcome = await executeActions(ctx, [
      { type: "add_comment", subject_type: "task", subject_ref: "nonexistent", text: "hi" },
    ]);
    expect(outcome.executions[0]!.status).toBe("clarify");

    await db.insert(tasks).values([
      { householdId: household.id, title: "wash the car", status: "open" },
      { householdId: household.id, title: "wash the dog", status: "open" },
    ]);
    outcome = await executeActions(ctx, [
      { type: "add_comment", subject_type: "task", subject_ref: "wash", text: "started" },
    ]);
    expect(outcome.executions[0]!.status).toBe("clarify");
    expect(outcome.reply).toContain("Which task?");
  });

  test("comments on events resolve by title ref", async () => {
    if (!available) return;
    const { household, member } = await fixture();
    await db
      .insert(events)
      .values({ householdId: household.id, title: "piano recital", startsAt: new Date() })
      .returning();

    const outcome = await executeActions(ctxFor(household, member), [
      { type: "add_comment", subject_type: "event", subject_ref: "recital", text: "runs 6–8pm, bring flowers" },
    ]);
    expect(outcome.executions[0]!.status).toBe("executed");
    expect(outcome.reply).toContain('Noted on "piano recital"');
  });
});
