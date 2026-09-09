import type { ProposedAction } from "@fambot/shared";
import type { Db } from "@fambot/database";
import { authorizeAction, type Actor } from "./authorization";
import {
  formatLocal,
  resolveLocalDateTime,
  resolvePersonName,
  ResolutionError,
} from "./resolution";
import type { Services } from "./services";

export type PersonRef = { id: string; displayName: string };

/** Optional external calendar hook (Google). Wired by the API when connected. */
export interface ExternalCalendar {
  createEvent(input: {
    title: string;
    startsAt: Date;
    endsAt: Date | null;
    location: string | null;
    timezone: string;
  }): Promise<{ externalId: string; htmlLink?: string }>;
  searchEvents(input: { start: Date; end: Date; query: string | null }): Promise<
    Array<{ title: string; startsAt: Date; location: string | null }>
  >;
}

export type ExecutionContext = {
  db: Db;
  services: Services;
  externalCalendar?: ExternalCalendar | null;
  householdId: string;
  timezone: string;
  actor: Actor & { displayName: string };
  conversation: { id: string; kind: "direct" | "group"; channel: "imessage" | "app_chat" } | null;
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
    const authz = authorizeAction(ctx.actor, action);
    if (!authz.ok) {
      replies.push(authz.reason);
      executions.push({ actionType: action.type, args: action, result: { reason: authz.reason }, status: "rejected" });
      continue;
    }
    try {
      const { text, result, status } = await executeOne(ctx, action);
      replies.push(text);
      executions.push({ actionType: action.type, args: action, result, status });
    } catch (err) {
      const msg =
        err instanceof ResolutionError
          ? `I couldn't work that out: ${err.message}`
          : "Something went wrong executing that.";
      replies.push(msg);
      executions.push({
        actionType: action.type,
        args: action,
        result: { error: err instanceof Error ? err.message : String(err) },
        status: "failed",
      });
    }
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
      let targetType: "member" | "conversation" = "member";
      let targetMemberId: string | undefined = ctx.actor.memberId;
      // Origin conversation doubles as the delivery fallback for member targets.
      let targetConversationId: string | undefined = ctx.conversation?.id;
      let who = "you";
      if (action.target === "conversation") {
        if (!ctx.conversation) throw new ResolutionError("no conversation to remind");
        targetType = "conversation";
        targetMemberId = undefined;
        targetConversationId = ctx.conversation.id;
        who = "everyone here";
      } else if (action.target === "named_person") {
        const person = resolvePersonName(
          action.target_name ?? "",
          ctx.participants,
          ctx.householdMembers
        );
        if (!person) {
          return {
            text: `I don't know who "${action.target_name}" is — who do you mean?`,
            result: null,
            status: "clarify",
          };
        }
        targetMemberId = person.id;
        who = person.displayName;
      }
      const reminder = await services.reminders.create({
        householdId: ctx.householdId,
        creatorMemberId: ctx.actor.memberId,
        title: action.title,
        targetType,
        targetMemberId,
        targetConversationId,
        fireAt,
        rrule: action.rrule,
        timezone,
      });
      const whenText = reminder.nextFireAt
        ? formatLocal(reminder.nextFireAt, timezone) + (action.rrule ? " (recurring)" : "")
        : "per the schedule";
      return {
        text: `✓ Got it — I'll remind ${who} ${whenText}: ${action.title}`,
        result: { reminderId: reminder.id, nextFireAt: reminder.nextFireAt },
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
      let listId: string | null = null;
      if (action.list_name) {
        const list = await services.lists.create(ctx.householdId, action.list_name, ctx.actor.memberId);
        listId = list.id;
      }
      const task = await services.tasks.create({
        householdId: ctx.householdId,
        creatorMemberId: ctx.actor.memberId,
        conversationId: ctx.conversation?.id,
        title: action.title,
        listId,
        assigneeMemberId,
        dueAt,
        rrule: action.rrule,
        timezone,
        nagIntervalMin: action.nag_interval_minutes,
      });
      const dueText = dueAt
        ? ` — due ${formatLocal(dueAt, timezone)}${action.rrule ? " (recurring)" : ""}, I'll nag until it's done`
        : "";
      return {
        text: `✓ Task added${assigneeName}: ${action.title}${dueText}`,
        result: { taskId: task.id },
        status: "executed",
      };
    }

    case "update_task": {
      const matches = await services.tasks.findByRef(ctx.householdId, action.task_ref);
      if (matches.length === 0)
        return { text: `I couldn't find an open task like "${action.task_ref}".`, result: null, status: "clarify" };
      if (matches.length > 1)
        return { text: `Which task? ${matches.map((m) => `"${m.title}"`).join(", ")}`, result: null, status: "clarify" };
      const patch: Record<string, unknown> = {};
      if (action.new_title) patch.title = action.new_title;
      if (action.new_due_at) {
        const at = resolveLocalDateTime(action.new_due_at, timezone);
        patch.dueAt = at;
        patch.nextNudgeAt = at;
      }
      if (action.new_list_name) {
        const list = await services.lists.create(ctx.householdId, action.new_list_name, ctx.actor.memberId);
        patch.listId = list.id;
      }
      const updated = await services.tasks.update(matches[0]!.id, patch);
      return { text: `✓ Updated task "${updated.title}"`, result: { taskId: updated.id }, status: "executed" };
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
      const { done, next } = await services.tasks.complete(task.id);
      const nextText = next?.dueAt ? ` Next one: ${formatLocal(next.dueAt, timezone)}.` : "";
      return {
        text: `✓ Nice — "${done!.title}" is done.${nextText}`,
        result: { taskId: task.id, respawnedTaskId: next?.id ?? null },
        status: "executed",
      };
    }

    case "cancel_task": {
      const matches = await services.tasks.findByRef(ctx.householdId, action.task_ref);
      if (matches.length === 0)
        return { text: `No open task matches "${action.task_ref}".`, result: null, status: "clarify" };
      if (matches.length > 1)
        return { text: `Which task should I cancel? ${matches.map((m) => `"${m.title}"`).join(", ")}`, result: null, status: "clarify" };
      await services.tasks.cancel(matches[0]!.id);
      return { text: `✓ Cancelled task "${matches[0]!.title}"`, result: { taskId: matches[0]!.id }, status: "executed" };
    }

    case "create_list": {
      const list = await services.lists.create(ctx.householdId, action.name, ctx.actor.memberId);
      return { text: `✓ List "${list.name}" is ready.`, result: { listId: list.id }, status: "executed" };
    }

    case "rename_list": {
      const list = await services.lists.findByName(ctx.householdId, action.name);
      if (!list) return { text: `No list called "${action.name}".`, result: null, status: "clarify" };
      await services.lists.rename(list.id, action.new_name);
      return { text: `✓ Renamed "${action.name}" to "${action.new_name}".`, result: { listId: list.id }, status: "executed" };
    }

    case "delete_list": {
      const list = await services.lists.findByName(ctx.householdId, action.name);
      if (!list) return { text: `No list called "${action.name}".`, result: null, status: "clarify" };
      await services.lists.remove(list.id);
      return {
        text: `✓ Deleted list "${list.name}" (its tasks moved to General).`,
        result: { listId: list.id },
        status: "executed",
      };
    }

    case "create_event": {
      const startsAt = resolveLocalDateTime(action.start_at, timezone);
      const endsAt = action.end_at ? resolveLocalDateTime(action.end_at, timezone) : null;
      if (ctx.externalCalendar) {
        const created = await ctx.externalCalendar.createEvent({
          title: action.title,
          startsAt,
          endsAt,
          location: action.location,
          timezone,
        });
        await ctx.services.events.create({
          householdId: ctx.householdId,
          creatorMemberId: ctx.actor.memberId,
          title: action.title,
          startsAt,
          endsAt,
          location: action.location,
          source: "google",
          externalId: created.externalId,
        });
        return {
          text: `✓ Added to Google Calendar: ${action.title} — ${formatLocal(startsAt, timezone)}`,
          result: { externalId: created.externalId },
          status: "executed",
        };
      }
      const event = await services.events.create({
        householdId: ctx.householdId,
        creatorMemberId: ctx.actor.memberId,
        title: action.title,
        startsAt,
        endsAt,
        location: action.location,
      });
      return {
        text: `✓ Added to the calendar: ${action.title} — ${formatLocal(startsAt, timezone)}`,
        result: { eventId: event.id },
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
