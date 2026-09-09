import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb, deliveries, households, members, reminders, tasks, conversations, conversationParticipants, type Db } from "@fambot/database";
import type { MessagingChannel } from "@fambot/messaging";
import { runWorkerOnce } from "./loops";

/**
 * Integration tests against the local Postgres (same instance dev uses).
 * Each test creates its own household so runs are isolated.
 */
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:fambot@localhost:5433/fambot";

let db: Db;
let available = false;

beforeAll(async () => {
  db = createDb(DATABASE_URL);
  try {
    await db.execute("select 1" as never);
    available = true;
  } catch {
    console.warn("[loops.test] local Postgres unavailable — skipping integration tests");
  }
});

class RecordingChannel implements MessagingChannel {
  sent: Array<{ conversationId: string; text: string }> = [];
  async sendMessage(args: { conversationId: string; text: string }) {
    this.sent.push(args);
  }
}

async function fixture() {
  const [household] = await db
    .insert(households)
    .values({ name: `test-${randomUUID().slice(0, 8)}`, timezone: "America/New_York" })
    .returning();
  const [member] = await db
    .insert(members)
    .values({ householdId: household!.id, displayName: "Tester", role: "owner" })
    .returning();
  const [conv] = await db
    .insert(conversations)
    .values({ householdId: household!.id, channel: "app_chat", kind: "direct", ownerMemberId: member!.id })
    .returning();
  await db.insert(conversationParticipants).values({ conversationId: conv!.id, memberId: member!.id });
  return { household: household!, member: member!, conversation: conv! };
}

describe("worker loops (integration)", () => {
  test("due reminder fires exactly once, then one-shot goes done", async () => {
    if (!available) return;
    const { household, member, conversation } = await fixture();
    const [reminder] = await db
      .insert(reminders)
      .values({
        householdId: household.id,
        creatorMemberId: member.id,
        title: "one-shot",
        targetType: "conversation",
        targetConversationId: conversation.id,
        fireAt: new Date(Date.now() - 1000),
        nextFireAt: new Date(Date.now() - 1000),
        timezone: household.timezone,
        status: "scheduled",
      })
      .returning();

    const channel = new RecordingChannel();
    await runWorkerOnce(db, channel);
    // Second run must be a no-op (claim moved it / status done)
    await runWorkerOnce(db, channel);

    const nudgesForUs = channel.sent.filter((s) => s.conversationId === conversation.id);
    expect(nudgesForUs).toHaveLength(1);
    expect(nudgesForUs[0]!.text).toContain("one-shot");

    const [after] = await db.select().from(reminders).where(eq(reminders.id, reminder!.id));
    expect(after!.status).toBe("done");
    expect(after!.nextFireAt).toBeNull();

    const audit = await db.select().from(deliveries).where(eq(deliveries.reminderId, reminder!.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.status).toBe("sent");
  });

  test("recurring reminder schedules the next occurrence after firing", async () => {
    if (!available) return;
    const { household, member, conversation } = await fixture();
    const [reminder] = await db
      .insert(reminders)
      .values({
        householdId: household.id,
        creatorMemberId: member.id,
        title: "weekly sync",
        targetType: "conversation",
        targetConversationId: conversation.id,
        fireAt: new Date(Date.now() - 1000),
        nextFireAt: new Date(Date.now() - 1000),
        rrule: "FREQ=DAILY",
        timezone: household.timezone,
        status: "scheduled",
      })
      .returning();

    await runWorkerOnce(db, new RecordingChannel());
    const [after] = await db.select().from(reminders).where(eq(reminders.id, reminder!.id));
    expect(after!.status).toBe("scheduled");
    expect(after!.nextFireAt!.getTime()).toBeGreaterThan(Date.now());
  });

  test("task nudges repeat on the nag interval and record deliveries", async () => {
    if (!available) return;
    const { household, member, conversation } = await fixture();
    const [task] = await db
      .insert(tasks)
      .values({
        householdId: household.id,
        creatorMemberId: member.id,
        conversationId: conversation.id,
        title: "sign the permission slip",
        dueAt: new Date(Date.now() - 1000),
        nextNudgeAt: new Date(Date.now() - 1000),
        nagIntervalMin: 30,
        timezone: household.timezone,
        status: "open",
      })
      .returning();

    const channel = new RecordingChannel();
    await runWorkerOnce(db, channel);
    await runWorkerOnce(db, channel); // not due again yet — must not double-nudge

    const nudges = channel.sent.filter((s) => s.conversationId === conversation.id);
    expect(nudges).toHaveLength(1);
    expect(nudges[0]!.text).toContain("Still open: sign the permission slip");

    const [after] = await db.select().from(tasks).where(eq(tasks.id, task!.id));
    // Next nudge is ~30 minutes out
    const delta = after!.nextNudgeAt!.getTime() - Date.now();
    expect(delta).toBeGreaterThan(25 * 60_000);
    expect(delta).toBeLessThan(35 * 60_000);

    // Completing stops the nagging
    await db.update(tasks).set({ status: "done", nextNudgeAt: null }).where(eq(tasks.id, task!.id));
    await runWorkerOnce(db, channel);
    expect(channel.sent.filter((s) => s.conversationId === conversation.id)).toHaveLength(1);
  });
});
