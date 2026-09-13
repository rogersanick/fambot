import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  createDb,
  deliveries,
  householdNotificationChannels,
  households,
  identities,
  members,
  messages,
  reminders,
  taskSeries,
  tasks,
  conversations,
  conversationParticipants,
  type Db,
} from "@fambot/database";
import { createServices } from "@fambot/domain";
import { NotificationDispatcher, TelnyxSmsChannel } from "@fambot/messaging";
import { runWorkerOnce } from "./loops";

/**
 * Integration tests against the local Postgres (same instance dev uses).
 * Each test creates its own household so runs are isolated. The worker runs
 * with a REAL NotificationDispatcher over a fake Telnyx fetch, so delivery
 * rows, dedupe keys, and SMS fan-out are all exercised end to end.
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

/** Real dispatcher wired to a fake Telnyx API that records every send. */
function makeNotifier() {
  const smsSent: Array<{ to: string; text: string }> = [];
  const telnyx = new TelnyxSmsChannel(db, {
    apiKey: "test-key",
    fromNumber: "+15550000000",
    fetchFn: (async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      smsSent.push({ to: body.to, text: body.text });
      return new Response(JSON.stringify({ data: { id: `tmsg_${randomUUID()}` } }), { status: 200 });
    }) as unknown as typeof fetch,
  });
  return { notifier: new NotificationDispatcher(db, { telnyx }), smsSent };
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
  const phone = `+1555${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
  await db.insert(identities).values({ memberId: member!.id, type: "phone", value: phone });
  await db.insert(householdNotificationChannels).values([
    { householdId: household!.id, channel: "sms", enabled: true },
    { householdId: household!.id, channel: "imessage", enabled: false },
  ]);
  const [conv] = await db
    .insert(conversations)
    .values({ householdId: household!.id, channel: "app_chat", kind: "direct", ownerMemberId: member!.id })
    .returning();
  await db.insert(conversationParticipants).values({ conversationId: conv!.id, memberId: member!.id });
  return { household: household!, member: member!, conversation: conv!, phone };
}

describe("worker loops (integration)", () => {
  test("due reminder fires exactly once over SMS, then one-shot goes done — never app chat", async () => {
    if (!available) return;
    const { household, member, conversation, phone } = await fixture();
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

    const { notifier, smsSent } = makeNotifier();
    await runWorkerOnce(db, notifier);
    // Second run must be a no-op (claim moved it / status done)
    await runWorkerOnce(db, notifier);

    const mine = smsSent.filter((s) => s.to === phone);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.text).toContain("one-shot");

    const [after] = await db.select().from(reminders).where(eq(reminders.id, reminder!.id));
    expect(after!.status).toBe("done");
    expect(after!.nextFireAt).toBeNull();

    const audit = await db.select().from(deliveries).where(eq(deliveries.reminderId, reminder!.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.channel).toBe("sms");
    expect(audit[0]!.status).toBe("queued");
    expect(audit[0]!.providerMessageId).toBeTruthy();

    // Scheduled notifications must never create outbound app-chat messages.
    const appChat = await db.select().from(messages).where(eq(messages.conversationId, conversation.id));
    expect(appChat).toHaveLength(0);
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

    await runWorkerOnce(db, makeNotifier().notifier);
    const [after] = await db.select().from(reminders).where(eq(reminders.id, reminder!.id));
    expect(after!.status).toBe("scheduled");
    expect(after!.nextFireAt!.getTime()).toBeGreaterThan(Date.now());
  });

  test("member without a phone yields an explicit skipped delivery, not a web-chat fallback", async () => {
    if (!available) return;
    const { household, member, conversation } = await fixture();
    await db.delete(identities).where(eq(identities.memberId, member.id));
    const [reminder] = await db
      .insert(reminders)
      .values({
        householdId: household.id,
        creatorMemberId: member.id,
        title: "phoneless",
        targetType: "member",
        targetMemberId: member.id,
        fireAt: new Date(Date.now() - 1000),
        nextFireAt: new Date(Date.now() - 1000),
        timezone: household.timezone,
        status: "scheduled",
      })
      .returning();

    const { notifier, smsSent } = makeNotifier();
    await runWorkerOnce(db, notifier);

    expect(smsSent).toHaveLength(0);
    const audit = await db.select().from(deliveries).where(eq(deliveries.reminderId, reminder!.id));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.status).toBe("skipped");
    expect(audit[0]!.error).toContain("no phone");
    const appChat = await db.select().from(messages).where(eq(messages.conversationId, conversation.id));
    expect(appChat).toHaveLength(0);
  });

  test("task nudges repeat on the nag interval, record deliveries, and link the SMS conversation", async () => {
    if (!available) return;
    const { household, member, conversation, phone } = await fixture();
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

    const { notifier, smsSent } = makeNotifier();
    await runWorkerOnce(db, notifier);
    await runWorkerOnce(db, notifier); // not due again yet — must not double-nudge

    const nudges = smsSent.filter((s) => s.to === phone);
    expect(nudges).toHaveLength(1);
    expect(nudges[0]!.text).toContain("Still open: sign the permission slip");

    // Delivery links the member's SMS conversation, so a bare SMS "done"
    // resolves via tasks.lastNudged.
    const [delivery] = await db.select().from(deliveries).where(eq(deliveries.taskId, task!.id));
    expect(delivery!.conversationId).toBeTruthy();
    const [smsConv] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, delivery!.conversationId!));
    expect(smsConv!.channel).toBe("sms");
    expect(smsConv!.externalId).toBe(phone);
    const services = createServices(db);
    const nudged = await services.tasks.lastNudged(household.id, smsConv!.id);
    expect(nudged?.id).toBe(task!.id);

    const [after] = await db.select().from(tasks).where(eq(tasks.id, task!.id));
    // Next nudge is ~30 minutes out
    const delta = after!.nextNudgeAt!.getTime() - Date.now();
    expect(delta).toBeGreaterThan(25 * 60_000);
    expect(delta).toBeLessThan(35 * 60_000);

    // Completing stops the nagging
    await db.update(tasks).set({ status: "done", nextNudgeAt: null }).where(eq(tasks.id, task!.id));
    await runWorkerOnce(db, notifier);
    expect(smsSent.filter((s) => s.to === phone)).toHaveLength(1);
  });

  // --- recurring task series ------------------------------------------------

  async function seriesFixture(
    f: Awaited<ReturnType<typeof fixture>>,
    opts: { rrule: string; anchorAt: Date; nextOccurrenceAt?: Date | null }
  ) {
    const [series] = await db
      .insert(taskSeries)
      .values({
        householdId: f.household.id,
        creatorMemberId: f.member.id,
        conversationId: f.conversation.id,
        title: "water the plants",
        rrule: opts.rrule,
        timezone: f.household.timezone,
        anchorAt: opts.anchorAt,
        nagIntervalMin: 30,
        nextOccurrenceAt: opts.nextOccurrenceAt ?? opts.anchorAt,
        status: "active",
      })
      .returning();
    return series!;
  }

  test("series spawns the next occurrence on schedule even while a previous one is open", async () => {
    if (!available) return;
    const f = await fixture();
    const anchor = new Date(Date.now() - 3_600_000); // this week's slot, 1h ago
    const series = await seriesFixture(f, { rrule: "FREQ=WEEKLY", anchorAt: anchor });

    // Last week's occurrence is still open — must not block generation.
    const lastWeek = new Date(anchor.getTime() - 7 * 86_400_000);
    await db.insert(tasks).values({
      householdId: f.household.id,
      creatorMemberId: f.member.id,
      conversationId: f.conversation.id,
      title: "water the plants",
      dueAt: lastWeek,
      nextNudgeAt: lastWeek,
      timezone: f.household.timezone,
      seriesId: series.id,
      scheduledFor: lastWeek,
      status: "open",
    });

    await runWorkerOnce(db, makeNotifier().notifier);

    const rows = await db.select().from(tasks).where(eq(tasks.seriesId, series.id));
    expect(rows.filter((t) => t.status === "open")).toHaveLength(2);
    const spawned = rows.find((t) => t.scheduledFor?.getTime() === anchor.getTime());
    expect(spawned).toBeDefined();
    expect(spawned!.dueAt!.getTime()).toBe(anchor.getTime());
    expect(spawned!.nextNudgeAt).not.toBeNull();

    // Cursor advanced to next week's slot.
    const [after] = await db.select().from(taskSeries).where(eq(taskSeries.id, series.id));
    expect(after!.status).toBe("active");
    expect(after!.nextOccurrenceAt!.getTime()).toBeGreaterThan(Date.now());
  });

  test("occurrence generation is idempotent across retries and concurrent claims", async () => {
    if (!available) return;
    const f = await fixture();
    const anchor = new Date(Date.now() - 3_600_000);
    const series = await seriesFixture(f, { rrule: "FREQ=WEEKLY", anchorAt: anchor });

    await runWorkerOnce(db, makeNotifier().notifier);
    // Simulate a crashed worker whose lease expired: cursor points back at
    // the already-materialized slot.
    await db
      .update(taskSeries)
      .set({ nextOccurrenceAt: anchor, status: "active" })
      .where(eq(taskSeries.id, series.id));
    await runWorkerOnce(db, makeNotifier().notifier);

    const rows = await db.select().from(tasks).where(eq(tasks.seriesId, series.id));
    expect(rows).toHaveLength(1); // unique (series_id, scheduled_for) held
  });

  test("COUNT-limited series exhausts after its last occurrence", async () => {
    if (!available) return;
    const f = await fixture();
    const anchor = new Date(Date.now() - 1000);
    const series = await seriesFixture(f, { rrule: "FREQ=DAILY;COUNT=1", anchorAt: anchor });

    await runWorkerOnce(db, makeNotifier().notifier);

    const rows = await db.select().from(tasks).where(eq(tasks.seriesId, series.id));
    expect(rows).toHaveLength(1);
    const [after] = await db.select().from(taskSeries).where(eq(taskSeries.id, series.id));
    expect(after!.status).toBe("exhausted");
    expect(after!.nextOccurrenceAt).toBeNull();
  });

  test("completing an occurrence never respawns; nudging stops for it alone", async () => {
    if (!available) return;
    const f = await fixture();
    const services = createServices(db);
    const anchor = new Date(Date.now() - 1000);
    const { series, task } = await services.taskSeries.create({
      householdId: f.household.id,
      creatorMemberId: f.member.id,
      conversationId: f.conversation.id,
      title: "take out the trash",
      firstDueAt: anchor,
      rrule: "FREQ=WEEKLY",
      timezone: f.household.timezone,
    });
    expect(task.scheduledFor!.getTime()).toBe(anchor.getTime());

    const before = await db.select().from(tasks).where(eq(tasks.seriesId, series.id));
    const done = await services.tasks.complete(task.id);
    expect(done!.status).toBe("done");
    expect(done!.nextNudgeAt).toBeNull();

    const after = await db.select().from(tasks).where(eq(tasks.seriesId, series.id));
    expect(after).toHaveLength(before.length); // no respawned row

    // The series cursor (set at create) is untouched by completion.
    const [s] = await db.select().from(taskSeries).where(eq(taskSeries.id, series.id));
    expect(s!.nextOccurrenceAt!.getTime()).toBeGreaterThan(Date.now());
  });

  test("postponing one occurrence moves only its due time, not its series slot", async () => {
    if (!available) return;
    const f = await fixture();
    const services = createServices(db);
    const anchor = new Date(Date.now() - 1000);
    const { series, task } = await services.taskSeries.create({
      householdId: f.household.id,
      creatorMemberId: f.member.id,
      title: "clean the kitchen",
      firstDueAt: anchor,
      rrule: "FREQ=WEEKLY",
      timezone: f.household.timezone,
    });

    const newDue = new Date(Date.now() + 3 * 3_600_000);
    await services.tasks.update(task.id, { dueAt: newDue, nextNudgeAt: newDue });

    const [after] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(after!.dueAt!.getTime()).toBe(newDue.getTime());
    expect(after!.nextNudgeAt!.getTime()).toBe(newDue.getTime());
    expect(after!.scheduledFor!.getTime()).toBe(anchor.getTime()); // slot unchanged

    const [s] = await db.select().from(taskSeries).where(eq(taskSeries.id, series.id));
    expect(s!.nextOccurrenceAt!.getTime()).toBeGreaterThan(Date.now()); // schedule unchanged
  });

  test("spawned occurrence is nudged on its cadence in the same pass and keeps nagging until done", async () => {
    if (!available) return;
    const f = await fixture();
    const anchor = new Date(Date.now() - 1000);
    const series = await seriesFixture(f, { rrule: "FREQ=DAILY;COUNT=1", anchorAt: anchor });

    const { notifier, smsSent } = makeNotifier();
    await runWorkerOnce(db, notifier); // spawns, then nudges the fresh occurrence
    const nudges = smsSent.filter((s) => s.to === f.phone);
    expect(nudges).toHaveLength(1);
    expect(nudges[0]!.text).toContain("Still open: water the plants");

    const [occ] = await db.select().from(tasks).where(eq(tasks.seriesId, series.id));
    // Next nudge honors the series' 30-minute cadence.
    const delta = occ!.nextNudgeAt!.getTime() - Date.now();
    expect(delta).toBeGreaterThan(25 * 60_000);
    expect(delta).toBeLessThan(35 * 60_000);

    // Second pass before the cadence elapses: no double nudge.
    await runWorkerOnce(db, notifier);
    expect(smsSent.filter((s) => s.to === f.phone)).toHaveLength(1);
  });

  test("cancelling a series stops generation and cancels its open occurrences", async () => {
    if (!available) return;
    const f = await fixture();
    const services = createServices(db);
    const anchor = new Date(Date.now() - 1000);
    const { series, task } = await services.taskSeries.create({
      householdId: f.household.id,
      creatorMemberId: f.member.id,
      title: "walk the dog",
      firstDueAt: anchor,
      rrule: "FREQ=DAILY",
      timezone: f.household.timezone,
    });

    await services.taskSeries.cancel(f.household.id, series.id);

    const [s] = await db.select().from(taskSeries).where(eq(taskSeries.id, series.id));
    expect(s!.status).toBe("cancelled");
    expect(s!.nextOccurrenceAt).toBeNull();
    const [occ] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    expect(occ!.status).toBe("cancelled");
    expect(occ!.nextNudgeAt).toBeNull();

    // Worker no longer touches the cancelled series.
    const { notifier, smsSent } = makeNotifier();
    await runWorkerOnce(db, notifier);
    expect(smsSent.filter((m) => m.to === f.phone)).toHaveLength(0);
  });
});
