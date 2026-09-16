import { and, asc, desc, eq, gt, gte, ilike, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Db } from "@fambot/database";
import {
  checklistItems,
  comments,
  deliveries,
  events,
  householdNotificationChannels,
  lists,
  members,
  reminders,
  taskSeries,
  tasks,
} from "@fambot/database";
import { nextOccurrence, occurrencesBetween, validateRRule } from "./resolution";

/**
 * Domain services: plain application code backed by Postgres. The AI never
 * touches these directly — the executor calls them after validation,
 * authorization, and resolution.
 */

export type CreateReminderInput = {
  householdId: string;
  creatorMemberId: string;
  title: string;
  taskId?: string | null;
  eventId?: string | null;
  targetType: "member" | "conversation";
  targetMemberId?: string;
  targetConversationId?: string;
  fireAt: Date | null;
  rrule: string | null;
  timezone: string;
  untilCompleted?: boolean;
};

export function createReminderService(db: Db) {
  return {
    async create(input: CreateReminderInput) {
      if (input.rrule) validateRRule(input.rrule);
      let nextFireAt = input.fireAt;
      if (!nextFireAt && input.rrule) {
        nextFireAt = nextOccurrence(input.rrule, input.timezone, new Date(), new Date());
      }
      if (!nextFireAt) throw new Error("reminder needs a fire time or recurrence");
      const taskId = input.taskId ?? null;
      const eventId = input.eventId ?? null;
      if (taskId && eventId) {
        throw new Error("reminder cannot attach to both a task and an event");
      }
      const [row] = await db
        .insert(reminders)
        .values({
          householdId: input.householdId,
          creatorMemberId: input.creatorMemberId,
          title: input.title,
          taskId,
          eventId,
          targetType: input.targetType,
          targetMemberId: input.targetMemberId,
          targetConversationId: input.targetConversationId,
          fireAt: input.fireAt,
          rrule: input.rrule,
          timezone: input.timezone,
          nextFireAt,
          untilCompleted: Boolean(input.untilCompleted && taskId),
          status: "scheduled",
        })
        .returning();
      return row!;
    },

    async findByRef(householdId: string, ref: string) {
      return db
        .select()
        .from(reminders)
        .where(
          and(
            eq(reminders.householdId, householdId),
            eq(reminders.status, "scheduled"),
            ilike(reminders.title, `%${ref}%`)
          )
        )
        .limit(5);
    },

    async update(
      id: string,
      patch: Partial<{
        title: string;
        fireAt: Date;
        nextFireAt: Date;
        rrule: string | null;
        taskId: string | null;
        eventId: string | null;
        untilCompleted: boolean;
      }>
    ) {
      if (patch.taskId && patch.eventId) {
        throw new Error("reminder cannot attach to both a task and an event");
      }
      const next: typeof patch = { ...patch };
      if (patch.taskId) next.eventId = null;
      if (patch.eventId) next.taskId = null;
      if (patch.taskId === null || patch.eventId) next.untilCompleted = false;
      const [row] = await db
        .update(reminders)
        .set({ ...next, updatedAt: new Date() })
        .where(eq(reminders.id, id))
        .returning();
      return row!;
    },

    async cancel(id: string) {
      await db
        .update(reminders)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(reminders.id, id));
    },

    /** Cancel remaining scheduled reminders when a task is completed or cancelled. */
    async cancelForTask(taskId: string) {
      await db
        .update(reminders)
        .set({ status: "cancelled", nextFireAt: null, updatedAt: new Date() })
        .where(and(eq(reminders.taskId, taskId), eq(reminders.status, "scheduled")));
    },

    async listForTask(householdId: string, taskId: string) {
      return db
        .select()
        .from(reminders)
        .where(and(eq(reminders.householdId, householdId), eq(reminders.taskId, taskId)))
        .orderBy(reminders.nextFireAt);
    },

    async listForEvent(householdId: string, eventId: string) {
      return db
        .select()
        .from(reminders)
        .where(and(eq(reminders.householdId, householdId), eq(reminders.eventId, eventId)))
        .orderBy(reminders.nextFireAt);
    },

    async list(householdId: string) {
      return db
        .select()
        .from(reminders)
        .where(eq(reminders.householdId, householdId))
        .orderBy(desc(sql`${reminders.nextFireAt} IS NOT NULL`), reminders.nextFireAt, desc(reminders.createdAt))
        .limit(200);
    },
  };
}

export type CreateTaskInput = {
  householdId: string;
  creatorMemberId: string;
  conversationId?: string;
  title: string;
  notes?: string;
  eventId?: string | null;
  assigneeMemberId?: string | null;
  dueAt: Date | null;
  timezone: string;
};

export function createTaskService(db: Db) {
  return {
    async create(input: CreateTaskInput) {
      const [row] = await db
        .insert(tasks)
        .values({
          householdId: input.householdId,
          creatorMemberId: input.creatorMemberId,
          conversationId: input.conversationId,
          title: input.title,
          notes: input.notes,
          eventId: input.eventId ?? null,
          assigneeMemberId: input.assigneeMemberId ?? null,
          dueAt: input.dueAt,
          timezone: input.timezone,
          status: "open",
        })
        .returning();
      return row!;
    },

    async findByRef(householdId: string, ref: string) {
      return db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.householdId, householdId),
            eq(tasks.status, "open"),
            ilike(tasks.title, `%${ref}%`)
          )
        )
        .limit(5);
    },

    /** The task most recently notified in this conversation (for bare "done"). */
    async lastNudged(householdId: string, conversationId: string | null) {
      const rows = await db
        .select({ task: tasks })
        .from(deliveries)
        .innerJoin(tasks, eq(deliveries.taskId, tasks.id))
        .where(
          and(
            isNotNull(deliveries.taskId),
            eq(tasks.householdId, householdId),
            eq(tasks.status, "open"),
            conversationId ? eq(deliveries.conversationId, conversationId) : undefined
          )
        )
        .orderBy(desc(deliveries.createdAt))
        .limit(1);
      return rows[0]?.task ?? null;
    },

    /**
     * Complete a task. Only this occurrence is affected — recurring series
     * occurrences are generated on their fixed schedule by the worker, never
     * by completion.
     */
    async complete(id: string) {
      const [done] = await db
        .update(tasks)
        .set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(tasks.id, id), eq(tasks.status, "open")))
        .returning();
      if (done) {
        await db
          .update(reminders)
          .set({ status: "cancelled", nextFireAt: null, updatedAt: new Date() })
          .where(and(eq(reminders.taskId, id), eq(reminders.status, "scheduled")));
      }
      return done ?? null;
    },

    /** Earliest open occurrence of a series due after `after` (for "next one" copy). */
    async nextOpenInSeries(seriesId: string, after: Date) {
      const [row] = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.seriesId, seriesId), eq(tasks.status, "open"), gt(tasks.dueAt, after)))
        .orderBy(asc(tasks.dueAt))
        .limit(1);
      return row ?? null;
    },

    async cancel(id: string) {
      await db
        .update(tasks)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(tasks.id, id));
      await db
        .update(reminders)
        .set({ status: "cancelled", nextFireAt: null, updatedAt: new Date() })
        .where(and(eq(reminders.taskId, id), eq(reminders.status, "scheduled")));
    },

    async update(
      id: string,
      patch: Partial<{
        title: string;
        dueAt: Date | null;
        eventId: string | null;
        status: "open" | "done" | "cancelled";
        completedAt: Date | null;
        notes: string | null;
      }>
    ) {
      const [row] = await db
        .update(tasks)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(tasks.id, id))
        .returning();
      return row!;
    },

    async get(householdId: string, id: string) {
      const [row] = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.householdId, householdId)));
      return row ?? null;
    },

    async list(householdId: string) {
      return db
        .select()
        .from(tasks)
        .where(eq(tasks.householdId, householdId))
        .orderBy(desc(tasks.createdAt))
        .limit(300);
    },

    async listByEvent(householdId: string, eventId: string) {
      return db
        .select()
        .from(tasks)
        .where(and(eq(tasks.householdId, householdId), eq(tasks.eventId, eventId)))
        .orderBy(asc(tasks.dueAt), desc(tasks.createdAt));
    },
  };
}

// --- recurring task series -----------------------------------------------------

export type TaskSeriesRow = typeof taskSeries.$inferSelect;

export type CreateTaskSeriesInput = {
  householdId: string;
  creatorMemberId: string;
  conversationId?: string;
  title: string;
  notes?: string;
  eventId?: string | null;
  assigneeMemberId?: string | null;
  /** First occurrence — anchors the recurrence. */
  firstDueAt: Date;
  rrule: string;
  timezone: string;
};

/**
 * Insert one concrete occurrence for a series slot. Idempotent: the unique
 * (series_id, scheduled_for) index makes concurrent/retried generation a
 * no-op. Returns null when the occurrence already existed.
 */
export async function materializeOccurrence(
  db: Db,
  series: Pick<
    TaskSeriesRow,
    | "id"
    | "householdId"
    | "creatorMemberId"
    | "conversationId"
    | "title"
    | "notes"
    | "assigneeMemberId"
    | "timezone"
  >,
  scheduledFor: Date
) {
  const [row] = await db
    .insert(tasks)
    .values({
      householdId: series.householdId,
      creatorMemberId: series.creatorMemberId,
      conversationId: series.conversationId,
      title: series.title,
      notes: series.notes,
      assigneeMemberId: series.assigneeMemberId,
      dueAt: scheduledFor,
      timezone: series.timezone,
      seriesId: series.id,
      scheduledFor,
      status: "open",
    })
    .onConflictDoNothing({ target: [tasks.seriesId, tasks.scheduledFor] })
    .returning();
  return row ?? null;
}

export function createTaskSeriesService(db: Db) {
  return {
    /**
     * Create a series and materialize its first occurrence immediately so
     * the todo shows up right away. The cursor then points at the second
     * occurrence for the worker to spawn on schedule.
     */
    async create(input: CreateTaskSeriesInput) {
      validateRRule(input.rrule);
      const [series] = await db
        .insert(taskSeries)
        .values({
          householdId: input.householdId,
          creatorMemberId: input.creatorMemberId,
          conversationId: input.conversationId,
          title: input.title,
          notes: input.notes,
          assigneeMemberId: input.assigneeMemberId ?? null,
          rrule: input.rrule,
          timezone: input.timezone,
          anchorAt: input.firstDueAt,
          nextOccurrenceAt: input.firstDueAt,
          status: "active",
        })
        .returning();
      const task = await materializeOccurrence(db, series!, input.firstDueAt);
      const next = nextOccurrence(series!.rrule, series!.timezone, series!.anchorAt, input.firstDueAt);
      const [updated] = await db
        .update(taskSeries)
        .set(
          next
            ? { nextOccurrenceAt: next, updatedAt: new Date() }
            : { nextOccurrenceAt: null, status: "exhausted", updatedAt: new Date() }
        )
        .where(eq(taskSeries.id, series!.id))
        .returning();
      return { series: updated!, task: task! };
    },

    /**
     * Turn an existing scheduled task into the first occurrence of a new
     * series (chat: "make that repeat every week"). Does not spawn extra
     * rows — the task itself is the anchor occurrence.
     */
    async adopt(
      task: { id: string } & Pick<
        typeof tasks.$inferSelect,
        | "householdId"
        | "creatorMemberId"
        | "conversationId"
        | "title"
        | "notes"
        | "assigneeMemberId"
        | "dueAt"
      >,
      rrule: string,
      timezone: string
    ) {
      validateRRule(rrule);
      if (!task.dueAt) throw new Error("a task needs a due date before it can repeat");
      const [series] = await db
        .insert(taskSeries)
        .values({
          householdId: task.householdId,
          creatorMemberId: task.creatorMemberId ?? undefined,
          conversationId: task.conversationId ?? undefined,
          title: task.title,
          notes: task.notes ?? undefined,
          assigneeMemberId: task.assigneeMemberId,
          rrule,
          timezone,
          anchorAt: task.dueAt,
          nextOccurrenceAt: nextOccurrence(rrule, timezone, task.dueAt, task.dueAt),
          status: "active",
        })
        .returning();
      await db
        .update(tasks)
        .set({ seriesId: series!.id, scheduledFor: task.dueAt, updatedAt: new Date() })
        .where(eq(tasks.id, task.id));
      return series!;
    },

    async get(householdId: string, id: string) {
      const [row] = await db
        .select()
        .from(taskSeries)
        .where(and(eq(taskSeries.id, id), eq(taskSeries.householdId, householdId)));
      return row ?? null;
    },

    async update(
      householdId: string,
      id: string,
      patch: Partial<{
        title: string;
        notes: string | null;
        assigneeMemberId: string | null;
        rrule: string;
      }>
    ) {
      const existing = await this.get(householdId, id);
      if (!existing) return null;
      const set: Record<string, unknown> = { ...patch, updatedAt: new Date() };
      if (patch.rrule && patch.rrule !== existing.rrule) {
        validateRRule(patch.rrule);
        // Recompute the cursor under the new rule; a previously exhausted
        // series can come back to life.
        const next = nextOccurrence(patch.rrule, existing.timezone, existing.anchorAt, new Date());
        set.nextOccurrenceAt = next;
        set.status = next ? "active" : "exhausted";
      }
      const [row] = await db
        .update(taskSeries)
        .set(set)
        .where(and(eq(taskSeries.id, id), eq(taskSeries.householdId, householdId)))
        .returning();
      return row ?? null;
    },

    /**
     * Cancel a series. By default open occurrences are cancelled too ("make
     * it stop"); pass cancelOpenTasks: false to keep the current occurrence
     * notifying while only stopping future generation.
     */
    async cancel(householdId: string, id: string, opts: { cancelOpenTasks?: boolean } = {}) {
      const [row] = await db
        .update(taskSeries)
        .set({ status: "cancelled", nextOccurrenceAt: null, updatedAt: new Date() })
        .where(and(eq(taskSeries.id, id), eq(taskSeries.householdId, householdId)))
        .returning();
      if (row && (opts.cancelOpenTasks ?? true)) {
        const open = await db
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.seriesId, id), eq(tasks.status, "open")));
        await db
          .update(tasks)
          .set({ status: "cancelled", updatedAt: new Date() })
          .where(and(eq(tasks.seriesId, id), eq(tasks.status, "open")));
        if (open.length > 0) {
          await db
            .update(reminders)
            .set({ status: "cancelled", nextFireAt: null, updatedAt: new Date() })
            .where(and(eq(reminders.status, "scheduled"), inArray(reminders.taskId, open.map((t) => t.id))));
        }
      }
      return row ?? null;
    },

    async list(householdId: string) {
      return db
        .select()
        .from(taskSeries)
        .where(eq(taskSeries.householdId, householdId))
        .orderBy(desc(taskSeries.createdAt))
        .limit(200);
    },
  };
}

export type ChecklistItemRow = typeof checklistItems.$inferSelect;

export function createListService(db: Db) {
  return {
    async create(
      householdId: string,
      name: string,
      creatorMemberId?: string,
      taskId?: string | null,
      eventId?: string | null
    ) {
      const existing = await this.findByName(householdId, name);
      if (existing) return existing;
      const [row] = await db
        .insert(lists)
        .values({
          householdId,
          name: name.trim(),
          createdByMemberId: creatorMemberId,
          taskId: taskId ?? null,
          eventId: eventId ?? null,
        })
        .returning();
      return row!;
    },
    async findByName(householdId: string, name: string) {
      const rows = await db
        .select()
        .from(lists)
        .where(and(eq(lists.householdId, householdId), ilike(lists.name, name.trim())));
      return rows[0] ?? null;
    },
    async findByRef(householdId: string, ref: string) {
      return db
        .select()
        .from(lists)
        .where(and(eq(lists.householdId, householdId), ilike(lists.name, `%${ref.trim()}%`)))
        .orderBy(asc(lists.name))
        .limit(5);
    },
    async get(householdId: string, id: string) {
      const [row] = await db
        .select()
        .from(lists)
        .where(and(eq(lists.id, id), eq(lists.householdId, householdId)));
      return row ?? null;
    },
    async rename(householdId: string, id: string, newName: string) {
      return this.update(householdId, id, { name: newName });
    },
    async update(
      householdId: string,
      id: string,
      patch: { name?: string; taskId?: string | null; eventId?: string | null }
    ) {
      const current = await this.get(householdId, id);
      if (!current) return null;
      const [row] = await db
        .update(lists)
        .set({
          name: patch.name !== undefined ? patch.name.trim() : current.name,
          taskId: patch.taskId !== undefined ? patch.taskId : current.taskId,
          eventId: patch.eventId !== undefined ? patch.eventId : current.eventId,
        })
        .where(and(eq(lists.id, id), eq(lists.householdId, householdId)))
        .returning();
      return row ?? null;
    },
    /** Deleting a list removes its checklist items. */
    async remove(householdId: string, id: string) {
      const [row] = await db
        .delete(lists)
        .where(and(eq(lists.id, id), eq(lists.householdId, householdId)))
        .returning({ id: lists.id });
      return row ?? null;
    },
    async list(householdId: string) {
      return db.select().from(lists).where(eq(lists.householdId, householdId)).orderBy(lists.name);
    },
    async listForTask(householdId: string, taskId: string) {
      return db
        .select()
        .from(lists)
        .where(and(eq(lists.householdId, householdId), eq(lists.taskId, taskId)))
        .orderBy(lists.name);
    },
    async listForEvent(householdId: string, eventId: string) {
      return db
        .select()
        .from(lists)
        .where(and(eq(lists.householdId, householdId), eq(lists.eventId, eventId)))
        .orderBy(lists.name);
    },

    /** Checklist entries — never tasks. */
    async addItems(householdId: string, listId: string, titles: string[]) {
      const list = await this.get(householdId, listId);
      if (!list) return [];
      const existing = await this.items(householdId, listId);
      const start = existing.length;
      const values = titles
        .map((title) => title.trim())
        .filter(Boolean)
        .map((body, i) => ({
          listId,
          body,
          sortOrder: start + i,
        }));
      if (values.length === 0) return [];
      return db.insert(checklistItems).values(values).returning();
    },
    async items(householdId: string, listId: string) {
      const list = await this.get(householdId, listId);
      if (!list) return [];
      return db
        .select()
        .from(checklistItems)
        .where(eq(checklistItems.listId, listId))
        .orderBy(asc(checklistItems.sortOrder), asc(checklistItems.createdAt));
    },
    async findItemsByRef(householdId: string, listId: string, ref: string) {
      const list = await this.get(householdId, listId);
      if (!list) return [];
      return db
        .select()
        .from(checklistItems)
        .where(and(eq(checklistItems.listId, listId), ilike(checklistItems.body, `%${ref.trim()}%`)))
        .orderBy(asc(checklistItems.sortOrder), asc(checklistItems.createdAt))
        .limit(5);
    },
    async updateItem(
      householdId: string,
      itemId: string,
      patch: Partial<{ body: string; completedAt: Date | null; sortOrder: number }>
    ) {
      const [item] = await db
        .select({ item: checklistItems, listHouseholdId: lists.householdId })
        .from(checklistItems)
        .innerJoin(lists, eq(lists.id, checklistItems.listId))
        .where(and(eq(checklistItems.id, itemId), eq(lists.householdId, householdId)));
      if (!item) return null;
      const [row] = await db
        .update(checklistItems)
        .set(patch)
        .where(eq(checklistItems.id, itemId))
        .returning();
      return row ?? null;
    },
    async removeItem(householdId: string, itemId: string) {
      const [item] = await db
        .select({ id: checklistItems.id })
        .from(checklistItems)
        .innerJoin(lists, eq(lists.id, checklistItems.listId))
        .where(and(eq(checklistItems.id, itemId), eq(lists.householdId, householdId)));
      if (!item) return null;
      await db.delete(checklistItems).where(eq(checklistItems.id, itemId));
      return item;
    },
  };
}

export type CreateEventInput = {
  householdId: string;
  creatorMemberId?: string;
  title: string;
  startsAt: Date;
  endsAt?: Date | null;
  location?: string | null;
  notes?: string | null;
  rrule?: string | null;
  timezone?: string | null;
  source?: "internal" | "google";
  externalId?: string | null;
};

/** An event row as returned from search — recurring series are expanded. */
export type EventOccurrence = typeof events.$inferSelect;

export function createEventService(db: Db) {
  return {
    async create(input: CreateEventInput) {
      if (input.rrule) {
        validateRRule(input.rrule);
        if (!input.timezone) throw new Error("recurring events need a timezone");
      }
      const [row] = await db
        .insert(events)
        .values({
          householdId: input.householdId,
          creatorMemberId: input.creatorMemberId,
          title: input.title,
          startsAt: input.startsAt,
          endsAt: input.endsAt ?? null,
          location: input.location ?? null,
          notes: input.notes ?? null,
          rrule: input.rrule ?? null,
          timezone: input.timezone ?? null,
          source: input.source ?? "internal",
          externalId: input.externalId ?? null,
        })
        .returning();
      return row!;
    },

    /**
     * Events in [start, end]. Recurring series rows are expanded into their
     * occurrences within the range (id stays the series id); one-shot events
     * are returned as-is.
     */
    async search(
      householdId: string,
      start: Date,
      end: Date,
      query?: string | null
    ): Promise<EventOccurrence[]> {
      const oneShot = await db
        .select()
        .from(events)
        .where(
          and(
            eq(events.householdId, householdId),
            isNull(events.rrule),
            gte(events.startsAt, start),
            lte(events.startsAt, end),
            query ? ilike(events.title, `%${query}%`) : undefined
          )
        )
        .orderBy(events.startsAt)
        .limit(100);
      const series = await db
        .select()
        .from(events)
        .where(
          and(
            eq(events.householdId, householdId),
            isNotNull(events.rrule),
            lte(events.startsAt, end), // series can't occur before its anchor
            query ? ilike(events.title, `%${query}%`) : undefined
          )
        )
        .limit(100);
      const expanded = series.flatMap((s) => {
        const tz = s.timezone ?? "UTC";
        const durationMs = s.endsAt ? s.endsAt.getTime() - s.startsAt.getTime() : null;
        return occurrencesBetween(s.rrule!, tz, s.startsAt, start, end, 100).map((at) => ({
          ...s,
          startsAt: at,
          endsAt: durationMs !== null ? new Date(at.getTime() + durationMs) : null,
        }));
      });
      return [...oneShot, ...expanded]
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
        .slice(0, 100);
    },

    async listRange(householdId: string, start: Date, end: Date) {
      return this.search(householdId, start, end, null);
    },

    /** Title lookup for chat references ("the dentist appointment"), newest first. */
    async findByRef(householdId: string, ref: string) {
      return db
        .select()
        .from(events)
        .where(and(eq(events.householdId, householdId), ilike(events.title, `%${ref}%`)))
        .orderBy(desc(events.startsAt))
        .limit(5);
    },

    async get(householdId: string, id: string) {
      const [row] = await db
        .select()
        .from(events)
        .where(and(eq(events.id, id), eq(events.householdId, householdId)));
      return row ?? null;
    },

    /** Deleting a recurring event removes the whole series. */
    async remove(id: string) {
      await db.delete(events).where(eq(events.id, id));
    },
  };
}

// --- comments --------------------------------------------------------------

/** What a comment can attach to. Reminders are fire-and-forget — no threads. */
export type CommentSubjectType = "task" | "event" | "list";

export type CommentSubject = { type: CommentSubjectType; id: string };

export type CommentWithAuthor = {
  id: string;
  body: string;
  createdAt: Date;
  authorMemberId: string | null;
  authorName: string | null;
};

const subjectColumn = {
  task: comments.taskId,
  event: comments.eventId,
  list: comments.listId,
} as const;

export function createCommentService(db: Db) {
  /** True iff the subject row exists and belongs to the household. */
  async function subjectExists(householdId: string, subject: CommentSubject) {
    const table = subject.type === "task" ? tasks : subject.type === "event" ? events : lists;
    const [row] = await db
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.id, subject.id), eq(table.householdId, householdId)))
      .limit(1);
    return Boolean(row);
  }

  return {
    subjectExists,

    /** Append a comment. Returns null when the subject isn't in this household. */
    async add(input: {
      householdId: string;
      subject: CommentSubject;
      authorMemberId: string | null;
      body: string;
    }) {
      if (!(await subjectExists(input.householdId, input.subject))) return null;
      const [row] = await db
        .insert(comments)
        .values({
          householdId: input.householdId,
          taskId: input.subject.type === "task" ? input.subject.id : null,
          eventId: input.subject.type === "event" ? input.subject.id : null,
          listId: input.subject.type === "list" ? input.subject.id : null,
          authorMemberId: input.authorMemberId,
          body: input.body.trim(),
        })
        .returning();
      return row!;
    },

    /**
     * Newest-first comments for a subject with author names, household-scoped.
     * Returns null when the subject isn't in this household.
     */
    async listBySubject(
      householdId: string,
      subject: CommentSubject,
      limit = 50
    ): Promise<CommentWithAuthor[] | null> {
      if (!(await subjectExists(householdId, subject))) return null;
      const rows = await db
        .select({
          id: comments.id,
          body: comments.body,
          createdAt: comments.createdAt,
          authorMemberId: comments.authorMemberId,
          authorName: members.displayName,
        })
        .from(comments)
        .leftJoin(members, eq(comments.authorMemberId, members.id))
        .where(
          and(eq(comments.householdId, householdId), eq(subjectColumn[subject.type], subject.id))
        )
        .orderBy(desc(comments.createdAt))
        .limit(limit);
      return rows;
    },
  };
}

export function createNotificationChannelService(db: Db) {
  return {
    /** Household broadcast channels (sms/imessage) and whether each is enabled. */
    async list(householdId: string) {
      return db
        .select({
          channel: householdNotificationChannels.channel,
          enabled: householdNotificationChannels.enabled,
          conversationId: householdNotificationChannels.conversationId,
        })
        .from(householdNotificationChannels)
        .where(eq(householdNotificationChannels.householdId, householdId));
    },
  };
}

export type Services = {
  reminders: ReturnType<typeof createReminderService>;
  tasks: ReturnType<typeof createTaskService>;
  taskSeries: ReturnType<typeof createTaskSeriesService>;
  lists: ReturnType<typeof createListService>;
  events: ReturnType<typeof createEventService>;
  comments: ReturnType<typeof createCommentService>;
  notificationChannels: ReturnType<typeof createNotificationChannelService>;
};

export function createServices(db: Db): Services {
  return {
    reminders: createReminderService(db),
    tasks: createTaskService(db),
    taskSeries: createTaskSeriesService(db),
    lists: createListService(db),
    events: createEventService(db),
    comments: createCommentService(db),
    notificationChannels: createNotificationChannelService(db),
  };
}
