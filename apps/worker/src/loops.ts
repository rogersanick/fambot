import { eq, sql } from "drizzle-orm";
import type { Db } from "@fambot/database";
import { reminders, taskSeries, tasks } from "@fambot/database";
import { materializeOccurrence, nextOccurrence } from "@fambot/domain";
import type { DispatchOutcome, NotificationRequest } from "@fambot/messaging";

/**
 * Scheduled notifications go through the household's NotificationDispatcher —
 * never through web chat. The dispatcher broadcasts to every enabled channel
 * (SMS by default, iMessage opt-in), records one delivery row per recipient
 * and channel, and dedupes on a deterministic occurrence key so retries after
 * a crash can never double-send.
 *
 * Lease-based claims: claiming bumps the due timestamp ~2 minutes into the
 * future inside a single UPDATE ... FOR UPDATE SKIP LOCKED, so concurrent
 * workers never double-claim and a crash mid-dispatch retries automatically.
 */

export type ScheduledNotifier = {
  dispatch(req: NotificationRequest): Promise<DispatchOutcome>;
};

export async function runWorkerOnce(db: Db, notifier: ScheduledNotifier) {
  const spawned = await spawnDueTaskOccurrences(db);
  const fired = await fireDueReminders(db, notifier);
  return { fired, spawned };
}

// --- recurring task series -----------------------------------------------------

/** How far ahead occurrences are materialized so they show up in the UI early. */
const SERIES_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
/** Cap per series per pass; dense rules catch up over successive passes. */
const MAX_SPAWN_PER_CLAIM = 5;

/**
 * Advance due task-series cursors and create concrete occurrences on their
 * fixed schedule — regardless of whether earlier occurrences are still open.
 * The unique (series_id, scheduled_for) index makes retries and concurrent
 * workers idempotent, so the lease bump is purely an efficiency measure.
 */
async function spawnDueTaskOccurrences(db: Db): Promise<number> {
  const claimed = await db.execute(sql`
    UPDATE task_series SET next_occurrence_at = now() + interval '2 minutes'
    FROM (
      SELECT id, next_occurrence_at FROM task_series
      WHERE status = 'active' AND next_occurrence_at IS NOT NULL
        AND next_occurrence_at <= now() + interval '24 hours'
      ORDER BY next_occurrence_at
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    ) AS due
    WHERE task_series.id = due.id
    RETURNING task_series.id, task_series.household_id,
              task_series.title, task_series.notes, task_series.assignee_member_id,
              task_series.creator_member_id, task_series.conversation_id,
              task_series.rrule, task_series.timezone, task_series.anchor_at,
              due.next_occurrence_at AS due_at
  `);

  let count = 0;
  const horizon = new Date(Date.now() + SERIES_LOOKAHEAD_MS);
  for (const row of claimed.rows as Array<Record<string, unknown>>) {
    const seriesId = row.id as string;
    const rrule = row.rrule as string;
    const tz = row.timezone as string;
    const anchorAt = new Date(row.anchor_at as string);
    const series = {
      id: seriesId,
      householdId: row.household_id as string,
      creatorMemberId: row.creator_member_id as string | null,
      conversationId: row.conversation_id as string | null,
      title: row.title as string,
      notes: row.notes as string | null,
      assigneeMemberId: row.assignee_member_id as string | null,
      timezone: tz,
    };

    let at: Date | null = new Date(row.due_at as string);
    let spawnedForSeries = 0;
    while (at && at <= horizon && spawnedForSeries < MAX_SPAWN_PER_CLAIM) {
      const created = await materializeOccurrence(db, series, at);
      if (created) count++;
      spawnedForSeries++;
      at = nextOccurrence(rrule, tz, anchorAt, at);
    }

    if (at) {
      await db
        .update(taskSeries)
        .set({ nextOccurrenceAt: at, updatedAt: new Date() })
        .where(eq(taskSeries.id, seriesId));
    } else {
      await db
        .update(taskSeries)
        .set({ nextOccurrenceAt: null, status: "exhausted", updatedAt: new Date() })
        .where(eq(taskSeries.id, seriesId));
    }
  }
  return count;
}

// --- reminders ---------------------------------------------------------------

async function fireDueReminders(db: Db, notifier: ScheduledNotifier): Promise<number> {
  // The CTE returns the PRE-claim next_fire_at: it is the occurrence being
  // fired, and the deterministic dedupe key for its deliveries.
  const claimed = await db.execute(sql`
    UPDATE reminders r SET next_fire_at = now() + interval '2 minutes'
    FROM (
      SELECT id, next_fire_at AS occurrence_at FROM reminders
      WHERE status = 'scheduled' AND next_fire_at <= now()
      ORDER BY next_fire_at
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    ) AS due
    WHERE r.id = due.id
    RETURNING r.id, r.household_id, r.title, r.target_type, r.target_member_id,
              r.target_conversation_id, r.fire_at, r.rrule, r.timezone,
              r.task_id, r.event_id, r.until_completed,
              due.occurrence_at
  `);

  let count = 0;
  for (const row of claimed.rows as Array<Record<string, unknown>>) {
    const id = row.id as string;
    const title = row.title as string;
    const tz = row.timezone as string;
    const rrule = row.rrule as string | null;
    const taskId = (row.task_id as string | null) ?? null;
    const untilCompleted = Boolean(row.until_completed);
    const occurrenceAt = new Date(row.occurrence_at as string);
    const fireAt = row.fire_at ? new Date(row.fire_at as string) : occurrenceAt;

    if (untilCompleted && taskId) {
      const [parent] = await db
        .select({ status: tasks.status, conversationId: tasks.conversationId })
        .from(tasks)
        .where(eq(tasks.id, taskId));
      if (!parent || parent.status !== "open") {
        await db
          .update(reminders)
          .set({ status: "cancelled", nextFireAt: null, updatedAt: new Date() })
          .where(eq(reminders.id, id));
        continue;
      }
    }

    const aboutTask = Boolean(taskId);
    await notifier.dispatch({
      householdId: row.household_id as string,
      kind: "reminder",
      sourceId: id,
      taskId,
      occurrenceKey: occurrenceAt.toISOString(),
      target: {
        memberId: (row.target_member_id as string | null) ?? null,
        conversationId: (row.target_conversation_id as string | null) ?? null,
      },
      text: aboutTask
        ? `⏰ Still open: ${title} — reply "done" when it's finished.`
        : `⏰ Reminder: ${title}`,
    });

    // Advance the schedule only after the occurrence was durably fanned out.
    if (rrule) {
      const next = nextOccurrence(rrule, tz, fireAt, new Date());
      if (next) {
        await db.update(reminders).set({ nextFireAt: next, updatedAt: new Date() }).where(eq(reminders.id, id));
      } else {
        await db
          .update(reminders)
          .set({ status: "done", nextFireAt: null, updatedAt: new Date() })
          .where(eq(reminders.id, id));
      }
    } else {
      await db
        .update(reminders)
        .set({ status: "done", nextFireAt: null, updatedAt: new Date() })
        .where(eq(reminders.id, id));
    }
    count++;
  }
  return count;
}
