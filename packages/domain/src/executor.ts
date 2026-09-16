import type { ProposedAction } from "@fambot/shared";
import type { Db } from "@fambot/database";
import { authorizeAction, type Actor } from "./authorization";
import {
  formatLocal,
  nextOccurrence,
  resolveLocalDateTime,
  resolvePersonName,
  ResolutionError,
} from "./resolution";
import type { CommentSubjectType, CommentWithAuthor, Services } from "./services";

export type PersonRef = { id: string; displayName: string };

/**
 * Optional second AI pass: turns a comment thread into a short latest-status
 * reply. Comment bodies are untrusted user content. Returning null (or
 * throwing) falls back to a deterministic verbatim rendering.
 */
export type StatusSummarizer = (input: {
  subjectType: CommentSubjectType;
  title: string;
  /** Oldest first. */
  comments: CommentWithAuthor[];
}) => Promise<string | null>;

/** Optional external calendar hook (Google). Wired by the API when connected. */
export interface ExternalCalendar {
  createEvent(input: {
    title: string;
    startsAt: Date;
    endsAt: Date | null;
    location: string | null;
    notes: string | null;
    timezone: string;
    /** RFC-5545 rule — Google receives the whole series, not occurrences. */
    rrule: string | null;
  }): Promise<{ externalId: string; htmlLink?: string }>;
  searchEvents(input: { start: Date; end: Date; query: string | null }): Promise<
    Array<{ title: string; startsAt: Date; location: string | null }>
  >;
}

export type ExecutionContext = {
  db: Db;
  services: Services;
  externalCalendar?: ExternalCalendar | null;
  summarizeStatus?: StatusSummarizer | null;
  householdId: string;
  timezone: string;
  actor: Actor & { displayName: string };
  conversation: { id: string; kind: "direct" | "group"; channel: "imessage" | "app_chat" | "sms" } | null;
  participants: PersonRef[];
  householdMembers: PersonRef[];
};

export type ExecutionRecord = {
  actionType: string;
  args: ProposedAction;
  result: unknown;
  status: "executed" | "rejected" | "clarify" | "failed";
};

export type ExecutionOutcome = {
  reply: string;
  executions: ExecutionRecord[];
};

/**
 * Structured result of one authorized command. `message` is user-facing copy;
 * `data` is the typed payload (ids, counts) callers like the MCP tool layer
 * return to agents.
 */
export type SingleActionResult = {
  status: "executed" | "rejected" | "clarify" | "failed";
  message: string;
  data: unknown;
};

/**
 * Single orchestration path for calendar event creation (chat AND REST): when
 * a Google connection exists the event (including its recurrence, as a whole
 * series) goes to Google first; the internal row mirrors it either way.
 */
export async function createEventEntry(input: {
  services: Services;
  externalCalendar: ExternalCalendar | null;
  householdId: string;
  creatorMemberId?: string;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  location: string | null;
  notes: string | null;
  rrule: string | null;
  timezone: string;
}) {
  let external: { externalId: string; htmlLink?: string } | null = null;
  if (input.externalCalendar) {
    external = await input.externalCalendar.createEvent({
      title: input.title,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      location: input.location,
      notes: input.notes,
      timezone: input.timezone,
      rrule: input.rrule,
    });
  }
  const event = await input.services.events.create({
    householdId: input.householdId,
    creatorMemberId: input.creatorMemberId,
    title: input.title,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    location: input.location,
    notes: input.notes,
    rrule: input.rrule,
    timezone: input.rrule ? input.timezone : null,
    source: external ? "google" : "internal",
    externalId: external?.externalId ?? null,
  });
  return { event, external };
}

/**
 * Run ONE action through authorization → resolution → domain services and
 * return a structured result. This is the single entry point shared by the
 * batch executor and the MCP tool layer; it never throws.
 */
export async function executeSingleAction(
  ctx: ExecutionContext,
  action: ProposedAction
): Promise<SingleActionResult> {
  const authz = authorizeAction(ctx.actor, action);
  if (!authz.ok) {
    return { status: "rejected", message: authz.reason, data: { reason: authz.reason } };
  }
  try {
    const { text, result, status } = await executeOne(ctx, action);
    return { status, message: text, data: result };
  } catch (err) {
    const message =
      err instanceof ResolutionError
        ? `I couldn't work that out: ${err.message}`
        : "Something went wrong executing that.";
    return {
      status: "failed",
      message,
      data: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

/**
 * Validation happened at parse time (Zod). This runs authorization →
 * resolution → domain services for each proposed action and composes the
 * user-facing reply.
 */
export async function executeActions(
  ctx: ExecutionContext,
  actions: ProposedAction[]
): Promise<ExecutionOutcome> {
  const replies: string[] = [];
  const executions: ExecutionRecord[] = [];

  for (const action of actions) {
    const single = await executeSingleAction(ctx, action);
    replies.push(single.message);
    executions.push({ actionType: action.type, args: action, result: single.data, status: single.status });
  }

  return { reply: replies.join("\n"), executions };
}

async function executeOne(
  ctx: ExecutionContext,
  action: ProposedAction
): Promise<{ text: string; result: unknown; status: "executed" | "clarify" }> {
  const { services, timezone } = ctx;

  switch (action.type) {
    case "clarify":
      return { text: action.question, result: null, status: "clarify" };

    case "chat_reply":
      return { text: action.text, result: null, status: "executed" };

    case "create_reminder": {
      const fireAt = action.fire_at ? resolveLocalDateTime(action.fire_at, timezone) : null;
      if (fireAt && !action.rrule && fireAt.getTime() < Date.now() - 60_000) {
        throw new ResolutionError(`${formatLocal(fireAt, timezone)} is in the past`);
      }
      const targeting = resolveReminderTarget(ctx, action.target, action.target_name);
      if ("clarify" in targeting) return { text: targeting.clarify, result: null, status: "clarify" };

      let taskId: string | null = null;
      let eventId: string | null = null;
      let inferredTask = false;
      if (action.event_ref) {
        const resolved = await resolveOne(
          await services.events.findByRef(ctx.householdId, action.event_ref),
          "event",
          action.event_ref
        );
        if ("clarify" in resolved) return { text: resolved.clarify, result: null, status: "clarify" };
        eventId = resolved.id;
      } else if (action.task_ref) {
        const resolved = await resolveOne(
          await services.tasks.findByRef(ctx.householdId, action.task_ref),
          "task",
          action.task_ref
        );
        if ("clarify" in resolved) return { text: resolved.clarify, result: null, status: "clarify" };
        taskId = resolved.id;
      } else {
        const task = await services.tasks.create({
          householdId: ctx.householdId,
          creatorMemberId: ctx.actor.memberId,
          conversationId: ctx.conversation?.id,
          title: action.title,
          dueAt: fireAt,
          timezone,
        });
        taskId = task.id;
        inferredTask = true;
      }

      const untilCompleted =
        Boolean(taskId) && (action.until_completed ?? Boolean(action.rrule));
      const reminder = await services.reminders.create({
        householdId: ctx.householdId,
        creatorMemberId: ctx.actor.memberId,
        title: action.title,
        taskId,
        eventId,
        targetType: targeting.targetType,
        targetMemberId: targeting.targetMemberId,
        targetConversationId: targeting.targetConversationId,
        fireAt,
        rrule: action.rrule,
        timezone,
        untilCompleted,
      });
      const whenText = reminder.nextFireAt
        ? formatLocal(reminder.nextFireAt, timezone) +
          (action.rrule ? (untilCompleted ? " (every occurrence until it's done)" : " (recurring)") : "")
        : "per the schedule";
      const parentText = inferredTask ? ` I'll keep "${action.title}" open as a task.` : "";
      return {
        text: `✓ Got it — I'll remind ${targeting.who} ${whenText}: ${action.title}.${parentText}`,
        result: {
          reminderId: reminder.id,
          taskId,
          eventId,
          nextFireAt: reminder.nextFireAt,
        },
        status: "executed",
      };
    }

    case "update_reminder": {
      const matches = await services.reminders.findByRef(ctx.householdId, action.reminder_ref);
      if (matches.length === 0)
        return { text: `I couldn't find a reminder like "${action.reminder_ref}".`, result: null, status: "clarify" };
      if (matches.length > 1)
        return {
          text: `Which one? ${matches.map((m) => `"${m.title}"`).join(", ")}`,
          result: null,
          status: "clarify",
        };
      const target = matches[0]!;
      const patch: Record<string, unknown> = {};
      if (action.new_title) patch.title = action.new_title;
      if (action.new_fire_at) {
        const at = resolveLocalDateTime(action.new_fire_at, timezone);
        patch.fireAt = at;
        patch.nextFireAt = at;
      }
      if (action.new_rrule) patch.rrule = action.new_rrule;
      if (action.task_ref && action.event_ref) {
        return {
          text: "A reminder can attach to a task or an event, not both.",
          result: null,
          status: "clarify",
        };
      }
      if (action.task_ref) {
        const resolved = await resolveOne(
          await services.tasks.findByRef(ctx.householdId, action.task_ref),
          "task",
          action.task_ref
        );
        if ("clarify" in resolved) return { text: resolved.clarify, result: null, status: "clarify" };
        patch.taskId = resolved.id;
      } else if (action.event_ref) {
        const resolved = await resolveOne(
          await services.events.findByRef(ctx.householdId, action.event_ref),
          "event",
          action.event_ref
        );
        if ("clarify" in resolved) return { text: resolved.clarify, result: null, status: "clarify" };
        patch.eventId = resolved.id;
      }
      const updated = await services.reminders.update(target.id, patch);
      return {
        text: `✓ Updated "${updated.title}"${updated.nextFireAt ? ` — ${formatLocal(updated.nextFireAt, timezone)}` : ""}`,
        result: { reminderId: updated.id },
        status: "executed",
      };
    }

    case "cancel_reminder": {
      const matches = await services.reminders.findByRef(ctx.householdId, action.reminder_ref);
      if (matches.length === 0)
        return { text: `No scheduled reminder matches "${action.reminder_ref}".`, result: null, status: "clarify" };
      if (matches.length > 1)
        return {
          text: `Which one should I cancel? ${matches.map((m) => `"${m.title}"`).join(", ")}`,
          result: null,
          status: "clarify",
        };
      await services.reminders.cancel(matches[0]!.id);
      return { text: `✓ Cancelled "${matches[0]!.title}"`, result: { reminderId: matches[0]!.id }, status: "executed" };
    }

    case "create_task": {
      const dueAt = action.due_at ? resolveLocalDateTime(action.due_at, timezone) : null;
      let assigneeMemberId: string | null = null;
      let assigneeName = "";
      if (action.assignee_name) {
        const person = resolvePersonName(action.assignee_name, ctx.participants, ctx.householdMembers);
        if (!person)
          return {
            text: `I don't know who "${action.assignee_name}" is — who should do this?`,
            result: null,
            status: "clarify",
          };
        assigneeMemberId = person.id;
        assigneeName = ` for ${person.displayName}`;
      }
      let eventId: string | null = null;
      if (action.event_ref) {
        const resolved = await resolveOne(
          await services.events.findByRef(ctx.householdId, action.event_ref),
          "event",
          action.event_ref
        );
        if ("clarify" in resolved) return { text: resolved.clarify, result: null, status: "clarify" };
        eventId = resolved.id;
      }

      let taskId: string;
      let seriesId: string | null = null;
      let firstDueAt = dueAt;
      if (action.rrule) {
        firstDueAt = dueAt ?? nextOccurrence(action.rrule, timezone, new Date(), new Date());
        if (!firstDueAt) {
          throw new ResolutionError(`the recurrence "${action.rrule}" has no upcoming occurrence`);
        }
        const { series, task } = await services.taskSeries.create({
          householdId: ctx.householdId,
          creatorMemberId: ctx.actor.memberId,
          conversationId: ctx.conversation?.id,
          title: action.title,
          eventId,
          assigneeMemberId,
          firstDueAt,
          rrule: action.rrule,
          timezone,
        });
        if (eventId) await services.tasks.update(task.id, { eventId });
        taskId = task.id;
        seriesId = series.id;
      } else {
        const task = await services.tasks.create({
          householdId: ctx.householdId,
          creatorMemberId: ctx.actor.memberId,
          conversationId: ctx.conversation?.id,
          title: action.title,
          eventId,
          assigneeMemberId,
          dueAt,
          timezone,
        });
        taskId = task.id;
      }

      let listId: string | null = null;
      let itemCount = 0;
      if (action.checklist) {
        const list = await services.lists.create(
          ctx.householdId,
          action.checklist.title,
          ctx.actor.memberId,
          taskId
        );
        const items = action.checklist.items.length
          ? await services.lists.addItems(ctx.householdId, list.id, action.checklist.items)
          : [];
        listId = list.id;
        itemCount = items.length;
      } else if (action.list_ref) {
        const resolved = await resolveList(ctx, action.list_ref);
        if ("clarify" in resolved) return { text: resolved.clarify, result: null, status: "clarify" };
        await services.lists.update(ctx.householdId, resolved.list.id, { taskId });
        listId = resolved.list.id;
      }

      const reminderIds: string[] = [];
      const targeting = resolveReminderTarget(ctx, "sender", null);
      if (!("clarify" in targeting) && action.reminders?.length) {
        for (const spec of action.reminders) {
          const fireAt = spec.fire_at
            ? resolveLocalDateTime(spec.fire_at, timezone)
            : firstDueAt ?? dueAt;
          if (!fireAt) continue;
          const reminder = await services.reminders.create({
            householdId: ctx.householdId,
            creatorMemberId: ctx.actor.memberId,
            title: action.title,
            taskId,
            targetType: targeting.targetType,
            targetMemberId: targeting.targetMemberId,
            targetConversationId: targeting.targetConversationId,
            fireAt,
            rrule: spec.rrule,
            timezone,
            untilCompleted: Boolean(spec.rrule),
          });
          reminderIds.push(reminder.id);
        }
      }

      const parts: string[] = [];
      if (action.checklist && itemCount) {
        parts.push(`with the ${itemCount}-item “${action.checklist.title}” checklist`);
      } else if (action.checklist) {
        parts.push(`with checklist “${action.checklist.title}”`);
      } else if (action.list_ref && listId) {
        parts.push(`linked to the “${action.list_ref}” list`);
      }
      if (reminderIds.length === 1 && action.reminders?.[0]?.rrule) {
        parts.push("I'll remind you on that schedule until it's done");
      } else if (reminderIds.length === 1 && action.reminders?.[0]?.fire_at) {
        parts.push(
          `I'll remind you at ${formatLocal(resolveLocalDateTime(action.reminders[0].fire_at, timezone), timezone)}`
        );
      } else if (reminderIds.length > 0) {
        parts.push("I'll remind you as scheduled");
      }
      const dueText =
        firstDueAt && action.rrule
          ? ` — first one due ${formatLocal(firstDueAt, timezone)}`
          : dueAt
            ? ` — due ${formatLocal(dueAt, timezone)}`
            : "";
      const extra = parts.length ? ` ${parts.join(". ")}.` : "";
      return {
        text: `✓ Added “${action.title}”${assigneeName}${dueText}.${extra}`,
        result: { taskId, seriesId, listId, reminderIds },
        status: "executed",
      };
    }

    case "update_task": {
      const matches = await services.tasks.findByRef(ctx.householdId, action.task_ref);
      if (matches.length === 0)
        return { text: `I couldn't find an open task like "${action.task_ref}".`, result: null, status: "clarify" };
      if (matches.length > 1)
        return { text: `Which task? ${matches.map((m) => `"${m.title}"`).join(", ")}`, result: null, status: "clarify" };
      const target = matches[0]!;
      const notes: string[] = [];

      // Series-level changes first: recurrence on/off/changed.
      if (action.stop_recurrence && target.seriesId) {
        await services.taskSeries.cancel(ctx.householdId, target.seriesId, { cancelOpenTasks: false });
        notes.push("it won't repeat anymore");
      } else if (action.new_rrule) {
        if (target.seriesId) {
          await services.taskSeries.update(ctx.householdId, target.seriesId, { rrule: action.new_rrule });
          notes.push("recurrence updated for the whole series");
        } else {
          if (!target.dueAt && !action.new_due_at) {
            return {
              text: `"${target.title}" needs a due date before it can repeat — when should the first one be due?`,
              result: null,
              status: "clarify",
            };
          }
          const anchorTask = action.new_due_at
            ? { ...target, dueAt: resolveLocalDateTime(action.new_due_at, timezone) }
            : target;
          await services.taskSeries.adopt(anchorTask, action.new_rrule, target.timezone ?? timezone);
          notes.push("it now repeats");
        }
      }

      // Occurrence-level changes: postponing moves only this occurrence.
      const patch: Record<string, unknown> = {};
      if (action.new_title) patch.title = action.new_title;
      if (action.new_due_at) {
        const at = resolveLocalDateTime(action.new_due_at, timezone);
        patch.dueAt = at;
        if (target.seriesId) notes.push("just this occurrence — the rest keep their schedule");
      }
      const updated =
        Object.keys(patch).length > 0 ? await services.tasks.update(target.id, patch) : target;
      const noteText = notes.length > 0 ? ` (${notes.join("; ")})` : "";
      return { text: `✓ Updated task "${updated.title}"${noteText}`, result: { taskId: updated.id }, status: "executed" };
    }

    case "link_task_to_event": {
      const taskResolved = await resolveOne(
        await services.tasks.findByRef(ctx.householdId, action.task_ref),
        "task",
        action.task_ref
      );
      if ("clarify" in taskResolved) return { text: taskResolved.clarify, result: null, status: "clarify" };
      const eventResolved = await resolveOne(
        await services.events.findByRef(ctx.householdId, action.event_ref),
        "event",
        action.event_ref
      );
      if ("clarify" in eventResolved) return { text: eventResolved.clarify, result: null, status: "clarify" };
      await services.tasks.update(taskResolved.id, { eventId: eventResolved.id });
      return {
        text: `✓ Linked “${taskResolved.title}” to “${eventResolved.title}”.`,
        result: { taskId: taskResolved.id, eventId: eventResolved.id },
        status: "executed",
      };
    }

    case "link_list_to_task": {
      const resolved = await resolveList(ctx, action.list_name);
      if ("clarify" in resolved) return { text: resolved.clarify, result: null, status: "clarify" };
      const taskResolved = await resolveOne(
        await services.tasks.findByRef(ctx.householdId, action.task_ref),
        "task",
        action.task_ref
      );
      if ("clarify" in taskResolved) return { text: taskResolved.clarify, result: null, status: "clarify" };
      await services.lists.update(ctx.householdId, resolved.list.id, { taskId: taskResolved.id });
      return {
        text: `✓ Linked list “${resolved.list.name}” to task “${taskResolved.title}”.`,
        result: { listId: resolved.list.id, taskId: taskResolved.id },
        status: "executed",
      };
    }

    case "link_list_to_event": {
      const resolved = await resolveList(ctx, action.list_name);
      if ("clarify" in resolved) return { text: resolved.clarify, result: null, status: "clarify" };
      const eventResolved = await resolveOne(
        await services.events.findByRef(ctx.householdId, action.event_ref),
        "event",
        action.event_ref
      );
      if ("clarify" in eventResolved) return { text: eventResolved.clarify, result: null, status: "clarify" };
      await services.lists.update(ctx.householdId, resolved.list.id, { eventId: eventResolved.id });
      return {
        text: `✓ Linked list “${resolved.list.name}” to event “${eventResolved.title}”.`,
        result: { listId: resolved.list.id, eventId: eventResolved.id },
        status: "executed",
      };
    }

    case "link_reminder_to_task": {
      const matches = await services.reminders.findByRef(ctx.householdId, action.reminder_ref);
      const reminderResolved = resolveOne(matches, "reminder", action.reminder_ref);
      if ("clarify" in reminderResolved) return { text: reminderResolved.clarify, result: null, status: "clarify" };
      const taskResolved = await resolveOne(
        await services.tasks.findByRef(ctx.householdId, action.task_ref),
        "task",
        action.task_ref
      );
      if ("clarify" in taskResolved) return { text: taskResolved.clarify, result: null, status: "clarify" };
      await services.reminders.update(reminderResolved.id, { taskId: taskResolved.id });
      return {
        text: `✓ Linked reminder “${reminderResolved.title}” to task “${taskResolved.title}”.`,
        result: { reminderId: reminderResolved.id, taskId: taskResolved.id },
        status: "executed",
      };
    }

    case "link_reminder_to_event": {
      const matches = await services.reminders.findByRef(ctx.householdId, action.reminder_ref);
      const reminderResolved = resolveOne(matches, "reminder", action.reminder_ref);
      if ("clarify" in reminderResolved) return { text: reminderResolved.clarify, result: null, status: "clarify" };
      const eventResolved = await resolveOne(
        await services.events.findByRef(ctx.householdId, action.event_ref),
        "event",
        action.event_ref
      );
      if ("clarify" in eventResolved) return { text: eventResolved.clarify, result: null, status: "clarify" };
      await services.reminders.update(reminderResolved.id, { eventId: eventResolved.id });
      return {
        text: `✓ Linked reminder “${reminderResolved.title}” to event “${eventResolved.title}”.`,
        result: { reminderId: reminderResolved.id, eventId: eventResolved.id },
        status: "executed",
      };
    }

    case "complete_task": {
      let task = null;
      if (action.task_ref) {
        const matches = await services.tasks.findByRef(ctx.householdId, action.task_ref);
        if (matches.length > 1)
          return { text: `Which task did you finish? ${matches.map((m) => `"${m.title}"`).join(", ")}`, result: null, status: "clarify" };
        task = matches[0] ?? null;
      } else {
        task = await services.tasks.lastNudged(ctx.householdId, ctx.conversation?.id ?? null);
      }
      if (!task)
        return { text: "I'm not sure which task you mean — which one is done?", result: null, status: "clarify" };
      const done = await services.tasks.complete(task.id);
      let nextText = "";
      if (done?.seriesId) {
        // Next occurrence is either already materialized or on the series cursor.
        const upcoming = await services.tasks.nextOpenInSeries(done.seriesId, new Date());
        const nextAt =
          upcoming?.dueAt ??
          (await services.taskSeries.get(ctx.householdId, done.seriesId))?.nextOccurrenceAt ??
          null;
        if (nextAt) nextText = ` Next one: ${formatLocal(nextAt, timezone)}.`;
      }
      return {
        text: `✓ Nice — "${done?.title ?? task.title}" is done.${nextText}`,
        result: { taskId: task.id },
        status: "executed",
      };
    }

    case "cancel_task": {
      const matches = await services.tasks.findByRef(ctx.householdId, action.task_ref);
      if (matches.length === 0)
        return { text: `No open task matches "${action.task_ref}".`, result: null, status: "clarify" };
      if (matches.length > 1)
        return { text: `Which task should I cancel? ${matches.map((m) => `"${m.title}"`).join(", ")}`, result: null, status: "clarify" };
      const target = matches[0]!;
      if (target.seriesId && action.cancel_series) {
        await services.taskSeries.cancel(ctx.householdId, target.seriesId);
        return {
          text: `✓ Cancelled "${target.title}" and stopped the recurring series.`,
          result: { taskId: target.id, seriesId: target.seriesId },
          status: "executed",
        };
      }
      await services.tasks.cancel(target.id);
      const hint = target.seriesId
        ? ` (it still repeats — say "cancel the whole series" to stop future ones)`
        : "";
      return { text: `✓ Cancelled task "${target.title}"${hint}`, result: { taskId: target.id }, status: "executed" };
    }

    case "create_list": {
      let taskId: string | null = null;
      let eventId: string | null = null;
      if (action.task_ref) {
        const resolved = await resolveOne(
          await services.tasks.findByRef(ctx.householdId, action.task_ref),
          "task",
          action.task_ref
        );
        if ("clarify" in resolved) return { text: resolved.clarify, result: null, status: "clarify" };
        taskId = resolved.id;
      }
      if (action.event_ref) {
        const resolved = await resolveOne(
          await services.events.findByRef(ctx.householdId, action.event_ref),
          "event",
          action.event_ref
        );
        if ("clarify" in resolved) return { text: resolved.clarify, result: null, status: "clarify" };
        eventId = resolved.id;
      }
      const list = await services.lists.create(
        ctx.householdId,
        action.name,
        ctx.actor.memberId,
        taskId,
        eventId
      );
      if (taskId || eventId) {
        await services.lists.update(ctx.householdId, list.id, {
          ...(taskId ? { taskId } : {}),
          ...(eventId ? { eventId } : {}),
        });
      }
      const items = action.items?.length
        ? await services.lists.addItems(ctx.householdId, list.id, action.items)
        : [];
      const itemText = items.length ? ` Added ${items.length} item${items.length === 1 ? "" : "s"}.` : "";
      const links = [
        taskId && action.task_ref ? `task “${action.task_ref}”` : null,
        eventId && action.event_ref ? `event “${action.event_ref}”` : null,
      ].filter(Boolean);
      const linkText = links.length ? ` Linked to ${links.join(" and ")}.` : "";
      return {
        text: `✓ List "${list.name}" is ready.${itemText}${linkText}`,
        result: { listId: list.id, itemIds: items.map((item) => item.id), taskId, eventId },
        status: "executed",
      };
    }

    case "rename_list": {
      const resolved = await resolveList(ctx, action.name);
      if ("clarify" in resolved) return { text: resolved.clarify, result: null, status: "clarify" };
      const list = resolved.list;
      await services.lists.rename(ctx.householdId, list.id, action.new_name);
      return { text: `✓ Renamed "${action.name}" to "${action.new_name}".`, result: { listId: list.id }, status: "executed" };
    }

    case "delete_list": {
      const resolved = await resolveList(ctx, action.name);
      if ("clarify" in resolved) return { text: resolved.clarify, result: null, status: "clarify" };
      const list = resolved.list;
      await services.lists.remove(ctx.householdId, list.id);
      return {
        text: `✓ Deleted list "${list.name}".`,
        result: { listId: list.id },
        status: "executed",
      };
    }

    case "add_list_items": {
      const resolved = await resolveList(ctx, action.list_name);
      if ("clarify" in resolved) return { text: resolved.clarify, result: null, status: "clarify" };
      const list = resolved.list;
      const items = await services.lists.addItems(ctx.householdId, list.id, action.items);
      return {
        text: `✓ Added ${items.map((item) => `"${item.body}"`).join(", ")} to "${list.name}".`,
        result: { listId: list.id, itemIds: items.map((item) => item.id) },
        status: "executed",
      };
    }

    case "update_list_item": {
      const resolved = await resolveListItem(ctx, action.list_name, action.item_ref);
      if ("clarify" in resolved) return { text: resolved.clarify, result: null, status: "clarify" };
      const updated = await services.lists.updateItem(ctx.householdId, resolved.item.id, {
        body: action.new_title,
      });
      return {
        text: `✓ Changed "${resolved.item.body}" to "${updated!.body}" on "${resolved.list.name}".`,
        result: { listId: resolved.list.id, itemId: updated!.id },
        status: "executed",
      };
    }

    case "set_list_item_completed": {
      const resolved = await resolveListItem(ctx, action.list_name, action.item_ref);
      if ("clarify" in resolved) return { text: resolved.clarify, result: null, status: "clarify" };
      const item = await services.lists.updateItem(ctx.householdId, resolved.item.id, {
        completedAt: action.completed ? new Date() : null,
      });
      return {
        text: `✓ Marked "${item!.body}" ${action.completed ? "done" : "not done"} on "${resolved.list.name}".`,
        result: { listId: resolved.list.id, itemId: item!.id, completed: action.completed },
        status: "executed",
      };
    }

    case "delete_list_item": {
      const resolved = await resolveListItem(ctx, action.list_name, action.item_ref);
      if ("clarify" in resolved) return { text: resolved.clarify, result: null, status: "clarify" };
      await services.lists.removeItem(ctx.householdId, resolved.item.id);
      return {
        text: `✓ Removed "${resolved.item.body}" from "${resolved.list.name}".`,
        result: { listId: resolved.list.id, itemId: resolved.item.id },
        status: "executed",
      };
    }

    case "get_list": {
      const resolved = await resolveList(ctx, action.list_name);
      if ("clarify" in resolved) return { text: resolved.clarify, result: null, status: "clarify" };
      const list = resolved.list;
      const items = await services.lists.items(ctx.householdId, list.id);
      const text =
        items.length === 0
          ? `"${list.name}" is empty.`
          : [`"${list.name}":`, ...items.map((item) => `${item.completedAt ? "✓" : "○"} ${item.body}`)].join(
              "\n"
            );
      return {
        text,
        result: { listId: list.id, itemIds: items.map((item) => item.id) },
        status: "executed",
      };
    }

    case "create_event": {
      const startsAt = resolveLocalDateTime(action.start_at, timezone);
      const endsAt = action.end_at ? resolveLocalDateTime(action.end_at, timezone) : null;
      let listId: string | null = null;
      let listName: string | null = null;
      if (action.list_ref) {
        const resolved = await resolveList(ctx, action.list_ref);
        if ("clarify" in resolved) return { text: resolved.clarify, result: null, status: "clarify" };
        listId = resolved.list.id;
        listName = resolved.list.name;
      }
      const { event, external } = await createEventEntry({
        services,
        externalCalendar: ctx.externalCalendar ?? null,
        householdId: ctx.householdId,
        creatorMemberId: ctx.actor.memberId,
        title: action.title,
        startsAt,
        endsAt,
        location: action.location,
        notes: action.notes,
        rrule: action.rrule,
        timezone,
      });
      if (listId) {
        await services.lists.update(ctx.householdId, listId, { eventId: event.id });
      }
      const reminderIds: string[] = [];
      const targeting = resolveReminderTarget(ctx, "sender", null);
      if (!("clarify" in targeting) && action.reminders?.length) {
        for (const spec of action.reminders) {
          const fireAt = spec.fire_at ? resolveLocalDateTime(spec.fire_at, timezone) : startsAt;
          if (!fireAt) continue;
          const reminder = await services.reminders.create({
            householdId: ctx.householdId,
            creatorMemberId: ctx.actor.memberId,
            title: action.title,
            eventId: event.id,
            targetType: targeting.targetType,
            targetMemberId: targeting.targetMemberId,
            targetConversationId: targeting.targetConversationId,
            fireAt,
            rrule: spec.rrule,
            timezone,
          });
          reminderIds.push(reminder.id);
        }
      }
      const extras = [
        listName ? `linked to the “${listName}” list` : null,
        reminderIds.length ? "I'll remind you as scheduled" : null,
      ].filter(Boolean);
      const extra = extras.length ? `. ${extras.join(". ")}.` : "";
      const recurringText = action.rrule ? " (recurring)" : "";
      if (external) {
        return {
          text: `✓ Added to Google Calendar: ${action.title} — ${formatLocal(startsAt, timezone)}${recurringText}${extra}`,
          result: { eventId: event.id, externalId: external.externalId, listId, reminderIds },
          status: "executed",
        };
      }
      return {
        text: `✓ Added to the calendar: ${action.title} — ${formatLocal(startsAt, timezone)}${recurringText}${extra}`,
        result: { eventId: event.id, listId, reminderIds },
        status: "executed",
      };
    }

    case "add_comment": {
      const resolved = await resolveCommentSubject(ctx, action.subject_type, action.subject_ref);
      if ("clarify" in resolved) return { text: resolved.clarify, result: null, status: "clarify" };
      const comment = await services.comments.add({
        householdId: ctx.householdId,
        subject: { type: action.subject_type, id: resolved.id },
        authorMemberId: ctx.actor.memberId,
        body: action.text,
      });
      return {
        text: `✓ Noted on "${resolved.title}": ${action.text}`,
        result: { commentId: comment!.id, subjectType: action.subject_type, subjectId: resolved.id },
        status: "executed",
      };
    }

    case "get_comment_status": {
      const resolved = await resolveCommentSubject(ctx, action.subject_type, action.subject_ref);
      if ("clarify" in resolved) return { text: resolved.clarify, result: null, status: "clarify" };
      const thread = await services.comments.listBySubject(
        ctx.householdId,
        { type: action.subject_type, id: resolved.id },
        10
      );
      if (!thread || thread.length === 0) {
        return {
          text: `No updates on "${resolved.title}" yet.`,
          result: { subjectType: action.subject_type, subjectId: resolved.id, count: 0 },
          status: "executed",
        };
      }
      const oldestFirst = [...thread].reverse();
      const summary = ctx.summarizeStatus
        ? await ctx
            .summarizeStatus({ subjectType: action.subject_type, title: resolved.title, comments: oldestFirst })
            .catch(() => null)
        : null;
      const text =
        summary ??
        [
          `Latest on "${resolved.title}":`,
          ...thread
            .slice(0, 5)
            .map((c) => `• ${c.authorName ?? "Fambot"} (${formatLocal(c.createdAt, timezone)}): ${c.body}`),
        ].join("\n");
      return {
        text,
        result: { subjectType: action.subject_type, subjectId: resolved.id, count: thread.length },
        status: "executed",
      };
    }

    case "search_schedule": {
      const start = action.start_at
        ? resolveLocalDateTime(action.start_at, timezone)
        : new Date();
      const end = action.end_at
        ? resolveLocalDateTime(action.end_at, timezone)
        : new Date(start.getTime() + 7 * 86_400_000);
      const internal = await services.events.search(ctx.householdId, start, end, action.query);
      const external = ctx.externalCalendar
        ? await ctx.externalCalendar.searchEvents({ start, end, query: action.query }).catch(() => [])
        : [];
      const combined = [
        ...internal.map((e) => ({ title: e.title, startsAt: e.startsAt, location: e.location })),
        ...external,
      ].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
      if (combined.length === 0) {
        return { text: "Nothing on the calendar for that time.", result: { count: 0 }, status: "executed" };
      }
      const lines = combined
        .slice(0, 10)
        .map((e) => `• ${formatLocal(e.startsAt, timezone)} — ${e.title}${e.location ? ` @ ${e.location}` : ""}`);
      return {
        text: lines.join("\n"),
        result: { count: combined.length },
        status: "executed",
      };
    }
  }
}

async function resolveList(
  ctx: ExecutionContext,
  ref: string
): Promise<
  | { list: Awaited<ReturnType<Services["lists"]["findByRef"]>>[number] }
  | { clarify: string }
> {
  const matches = await ctx.services.lists.findByRef(ctx.householdId, ref);
  if (matches.length === 0) return { clarify: `No list matches "${ref}".` };
  if (matches.length > 1) {
    return { clarify: `Which list? ${matches.map((list) => `"${list.name}"`).join(", ")}` };
  }
  return { list: matches[0]! };
}

async function resolveListItem(
  ctx: ExecutionContext,
  listName: string,
  itemRef: string
): Promise<
  | {
      list: Awaited<ReturnType<Services["lists"]["findByName"]>> & {};
      item: Awaited<ReturnType<Services["lists"]["findItemsByRef"]>>[number];
    }
  | { clarify: string }
> {
  const resolved = await resolveList(ctx, listName);
  if ("clarify" in resolved) return resolved;
  const list = resolved.list;
  const matches = await ctx.services.lists.findItemsByRef(ctx.householdId, list.id, itemRef);
  if (matches.length === 0) {
    return { clarify: `I couldn't find "${itemRef}" on "${list.name}".` };
  }
  if (matches.length > 1) {
    return {
      clarify: `Which item on "${list.name}"? ${matches.map((item) => `"${item.body}"`).join(", ")}`,
    };
  }
  return { list, item: matches[0]! };
}

function resolveReminderTarget(
  ctx: ExecutionContext,
  target: "sender" | "conversation" | "named_person",
  targetName: string | null
):
  | {
      targetType: "member" | "conversation";
      targetMemberId?: string;
      targetConversationId?: string;
      who: string;
    }
  | { clarify: string } {
  let targetType: "member" | "conversation" = "member";
  let targetMemberId: string | undefined = ctx.actor.memberId;
  let targetConversationId: string | undefined = ctx.conversation?.id;
  let who = "you";
  if (target === "conversation") {
    if (!ctx.conversation) throw new ResolutionError("no conversation to remind");
    targetType = "conversation";
    targetMemberId = undefined;
    targetConversationId = ctx.conversation.id;
    who = "everyone here";
  } else if (target === "named_person") {
    const person = resolvePersonName(targetName ?? "", ctx.participants, ctx.householdMembers);
    if (!person) return { clarify: `I don't know who "${targetName}" is — who do you mean?` };
    targetMemberId = person.id;
    who = person.displayName;
  }
  return { targetType, targetMemberId, targetConversationId, who };
}

function resolveOne<T extends { id: string; title: string }>(
  matches: T[],
  kind: string,
  ref: string
): { id: string; title: string } | { clarify: string } {
  if (matches.length === 0) return { clarify: `I couldn't find a ${kind} like "${ref}".` };
  if (matches.length > 1) {
    return { clarify: `Which ${kind}? ${matches.map((m) => `"${m.title}"`).join(", ")}` };
  }
  return { id: matches[0]!.id, title: matches[0]!.title };
}

/**
 * Household-scoped lookup of a comment subject by title/name words. Returns
 * a clarify message when nothing (or more than one thing) matches.
 */
async function resolveCommentSubject(
  ctx: ExecutionContext,
  subjectType: CommentSubjectType,
  ref: string
): Promise<{ id: string; title: string } | { clarify: string }> {
  const { services, householdId } = ctx;
  if (subjectType === "list") {
    const resolved = await resolveList(ctx, ref);
    return "clarify" in resolved
      ? resolved
      : { id: resolved.list.id, title: resolved.list.name };
  }
  const matches =
    subjectType === "task"
      ? await services.tasks.findByRef(householdId, ref)
      : await services.events.findByRef(householdId, ref);
  const label = subjectType === "task" ? "task" : "event";
  if (matches.length === 0) return { clarify: `I couldn't find a ${label} like "${ref}".` };
  if (matches.length > 1) {
    return { clarify: `Which ${label}? ${matches.map((m) => `"${m.title}"`).join(", ")}` };
  }
  return { id: matches[0]!.id, title: matches[0]!.title };
}
