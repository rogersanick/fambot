import { and, desc, eq, gte, ilike, isNull, lte, or, sql } from "drizzle-orm";
import type { Db } from "@fambot/database";
import {
  deliveries,
  events,
  lists,
  reminders,
  tasks,
} from "@fambot/database";
import { nextOccurrence, validateRRule } from "./resolution";

/**
 * Domain services: plain application code backed by Postgres. The AI never
 * touches these directly — the executor calls them after validation,
 * authorization, and resolution.
 */

export type CreateReminderInput = {
  householdId: string;
  creatorMemberId: string;
  title: string;
  targetType: "member" | "conversation";
  targetMemberId?: string;
  targetConversationId?: string;
  fireAt: Date | null;
  rrule: string | null;
  timezone: string;
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
      const [row] = await db
        .insert(reminders)
        .values({
          householdId: input.householdId,
          creatorMemberId: input.creatorMemberId,
          title: input.title,
          targetType: input.targetType,
          targetMemberId: input.targetMemberId,
          targetConversationId: input.targetConversationId,
          fireAt: input.fireAt,
          rrule: input.rrule,
          timezone: input.timezone,
          nextFireAt,
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
      patch: Partial<{ title: string; fireAt: Date; nextFireAt: Date; rrule: string | null }>
    ) {
      const [row] = await db
        .update(reminders)
        .set({ ...patch, updatedAt: new Date() })
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
  listId?: string | null;
  assigneeMemberId?: string | null;
  dueAt: Date | null;
  rrule: string | null;
  timezone: string;
  nagIntervalMin?: number | null;
};

export function createTaskService(db: Db) {
  return {
    async create(input: CreateTaskInput) {
      if (input.rrule) validateRRule(input.rrule);
      const [row] = await db
        .insert(tasks)
        .values({
          householdId: input.householdId,
          creatorMemberId: input.creatorMemberId,
          conversationId: input.conversationId,
          title: input.title,
          notes: input.notes,
          listId: input.listId ?? null,
          assigneeMemberId: input.assigneeMemberId ?? null,
          dueAt: input.dueAt,
          rrule: input.rrule,
          timezone: input.timezone,
          nagIntervalMin: input.nagIntervalMin ?? 30,
          nextNudgeAt: input.dueAt, // nagging starts when the task is due
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

    /** The task most recently nudged in this conversation (for bare "done"). */
    async lastNudged(householdId: string, conversationId: string | null) {
      const rows = await db
        .select({ task: tasks })
        .from(deliveries)
        .innerJoin(tasks, eq(deliveries.taskId, tasks.id))
        .where(
          and(
            eq(deliveries.kind, "task_nudge"),
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
     * Complete a task. Recurring tasks respawn the next occurrence as a new
     * open row so the completed one stays in history.
     */
    async complete(id: string) {
      const [done] = await db
        .update(tasks)
        .set({ status: "done", completedAt: new Date(), nextNudgeAt: null, updatedAt: new Date() })
        .where(and(eq(tasks.id, id), eq(tasks.status, "open")))
        .returning();
      if (!done) return { done: null, next: null };
      let next = null;
      if (done.rrule && done.dueAt && done.timezone) {
        const nextDue = nextOccurrence(done.rrule, done.timezone, done.dueAt, new Date());
        if (nextDue) {
          const [respawn] = await db
            .insert(tasks)
            .values({
              householdId: done.householdId,
              creatorMemberId: done.creatorMemberId,
              conversationId: done.conversationId,
              title: done.title,
              notes: done.notes,
              listId: done.listId,
              assigneeMemberId: done.assigneeMemberId,
              dueAt: nextDue,
              rrule: done.rrule,
              timezone: done.timezone,
              nagIntervalMin: done.nagIntervalMin,
              nextNudgeAt: nextDue,
              status: "open",
            })
            .returning();
          next = respawn!;
        }
      }
      return { done, next };
    },

    async cancel(id: string) {
      await db
        .update(tasks)
        .set({ status: "cancelled", nextNudgeAt: null, updatedAt: new Date() })
        .where(eq(tasks.id, id));
    },

    async update(
      id: string,
      patch: Partial<{ title: string; dueAt: Date; nextNudgeAt: Date | null; listId: string | null; status: "open" | "done" | "cancelled" }>
    ) {
      const [row] = await db
        .update(tasks)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(tasks.id, id))
        .returning();
      return row!;
    },

    async list(householdId: string) {
      return db
        .select()
        .from(tasks)
        .where(eq(tasks.householdId, householdId))
        .orderBy(desc(tasks.createdAt))
        .limit(300);
    },
  };
}

export function createListService(db: Db) {
  return {
    async create(householdId: string, name: string, creatorMemberId?: string) {
      const existing = await this.findByName(householdId, name);
      if (existing) return existing;
      const [row] = await db
        .insert(lists)
        .values({ householdId, name: name.trim(), createdByMemberId: creatorMemberId })
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
    async rename(id: string, newName: string) {
      const [row] = await db.update(lists).set({ name: newName.trim() }).where(eq(lists.id, id)).returning();
      return row!;
    },
    /** Deleting a list orphans its tasks back to "general" (list_id null via FK). */
    async remove(id: string) {
      await db.delete(lists).where(eq(lists.id, id));
    },
    async list(householdId: string) {
      return db.select().from(lists).where(eq(lists.householdId, householdId)).orderBy(lists.name);
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
  source?: "internal" | "google";
  externalId?: string | null;
};

export function createEventService(db: Db) {
  return {
    async create(input: CreateEventInput) {
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
          source: input.source ?? "internal",
          externalId: input.externalId ?? null,
        })
        .returning();
      return row!;
    },
    async search(householdId: string, start: Date, end: Date, query?: string | null) {
      return db
        .select()
        .from(events)
        .where(
          and(
            eq(events.householdId, householdId),
            gte(events.startsAt, start),
            lte(events.startsAt, end),
            query ? ilike(events.title, `%${query}%`) : undefined
          )
        )
        .orderBy(events.startsAt)
        .limit(100);
    },
    async listRange(householdId: string, start: Date, end: Date) {
      return this.search(householdId, start, end, null);
    },
    async remove(id: string) {
      await db.delete(events).where(eq(events.id, id));
    },
  };
}

export type Services = {
  reminders: ReturnType<typeof createReminderService>;
  tasks: ReturnType<typeof createTaskService>;
  lists: ReturnType<typeof createListService>;
  events: ReturnType<typeof createEventService>;
};

export function createServices(db: Db): Services {
  return {
    reminders: createReminderService(db),
    tasks: createTaskService(db),
    lists: createListService(db),
    events: createEventService(db),
  };
}
