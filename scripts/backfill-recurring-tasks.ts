/**
 * One-time backfill: convert legacy recurring tasks (tasks.rrule set on the
 * row itself, respawned on completion) into task_series rows with the task
 * as the current occurrence. Run after `bun run db:push`:
 *
 *   bun run scripts/backfill-recurring-tasks.ts
 *
 * Idempotent: only touches open tasks that still carry an rrule and are not
 * yet linked to a series. Completed/cancelled historical rows keep their
 * rrule for the record but are never respawned again.
 */
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { createDb, taskSeries, tasks } from "@fambot/database";
import { nextOccurrence } from "@fambot/domain";

const db = createDb(process.env.DATABASE_URL ?? "postgres://postgres:fambot@localhost:5433/fambot");

const legacy = await db
  .select()
  .from(tasks)
  .where(and(eq(tasks.status, "open"), isNotNull(tasks.rrule), isNull(tasks.seriesId)));

let converted = 0;
for (const task of legacy) {
  if (!task.dueAt || !task.timezone) {
    console.warn(`[backfill] skipping task ${task.id} ("${task.title}") — no dueAt/timezone anchor`);
    continue;
  }
  const [series] = await db
    .insert(taskSeries)
    .values({
      householdId: task.householdId,
      creatorMemberId: task.creatorMemberId,
      conversationId: task.conversationId,
      title: task.title,
      notes: task.notes,
      assigneeMemberId: task.assigneeMemberId,
      rrule: task.rrule!,
      timezone: task.timezone,
      anchorAt: task.dueAt,
      nextOccurrenceAt: nextOccurrence(task.rrule!, task.timezone, task.dueAt, new Date()),
      status: "active",
    })
    .returning();
  await db
    .update(tasks)
    .set({ seriesId: series!.id, scheduledFor: task.dueAt, rrule: null, updatedAt: new Date() })
    .where(eq(tasks.id, task.id));
  converted++;
  console.log(`[backfill] "${task.title}" → series ${series!.id}`);
}

console.log(`[backfill] done — converted ${converted} of ${legacy.length} legacy recurring task(s)`);
process.exit(0);
