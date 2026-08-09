import type { Sql } from "../db.ts";
import type { AgentContext, StructuredOutput, ValidatedAction } from "./types.ts";
import {
  composeClarification, composeEventConfirmation, composeEventList,
  composeHelp, composeRename, composeTaskConfirmation, composeTaskList,
} from "./composer.ts";
import { links } from "./deeplink.ts";

export interface ExecutionResult {
  replyText: string;
}

/**
 * Applies one validated action in ONE transaction: entity mutation, reminder
 * rows, audit (via trigger, attributed through transaction-locals), and the
 * outbox insert. An LLM or validation failure can never partially mutate.
 *
 * Structured as typed, household-scoped domain functions so a tool-calling
 * agent loop can be layered on later without rework.
 */
export async function execute(
  sql: Sql,
  ctx: AgentContext,
  action: ValidatedAction,
): Promise<ExecutionResult> {
  return await sql.begin(async (tx) => {
    await tx`select
      set_config('fambot.actor_type', 'bot', true),
      set_config('fambot.actor_member_id', ${ctx.sender.id}, true),
      set_config('fambot.inbound_message_id', ${ctx.inboundMessageId}, true)
    `;

    let replyText: string;
    switch (action.type) {
      case "create_task": {
        const task = await createTask(tx, ctx, action);
        replyText = composeTaskConfirmation(ctx, "Added", task, action.disclosedDefault);
        break;
      }
      case "update_task": {
        const task = await updateTask(tx, ctx, action);
        replyText = composeTaskConfirmation(ctx, "Updated", task, action.disclosedDefault);
        break;
      }
      case "complete_task": {
        const task = await completeTask(tx, ctx, action.task.id);
        replyText = composeTaskConfirmation(ctx, "Completed", task, null);
        break;
      }
      case "delete_task": {
        const task = await cancelTask(tx, ctx, action.task.id);
        replyText = composeTaskConfirmation(ctx, "Deleted", task, null);
        break;
      }
      case "delete_all_tasks": {
        const count = await cancelAllTasks(tx, ctx);
        replyText = `✓ Deleted ${count} open task${count === 1 ? "" : "s"}\n${links.tasks(ctx.household.slug)}`;
        break;
      }
      case "create_event": {
        const event = await createEvent(tx, ctx, action);
        replyText = composeEventConfirmation(ctx, "Added", event);
        break;
      }
      case "update_event": {
        const event = await updateEvent(tx, ctx, action);
        replyText = composeEventConfirmation(ctx, "Updated", event);
        break;
      }
      case "delete_event": {
        const event = await cancelEvent(tx, ctx, action.event.id);
        replyText = composeEventConfirmation(ctx, "Cancelled", event);
        break;
      }
      case "list_tasks":
        replyText = composeTaskList(ctx);
        break;
      case "list_events":
        replyText = composeEventList(ctx);
        break;
      case "rename_bot": {
        await tx`update households set invocation_name = ${action.newName} where id = ${ctx.household.id}`;
        replyText = composeRename(ctx, action.newName);
        break;
      }
      case "cancel_clarification": {
        await tx`
          update pending_clarifications
             set state = 'cancelled', resolved_at = now()
           where household_id = ${ctx.household.id} and state = 'open'
        `;
        replyText = `Okay, question dismissed.\n${links.today(ctx.household.slug)}`;
        break;
      }
      case "help":
        replyText = composeHelp(ctx);
        break;
    }

    // Executing any action resolves the open clarification when the action
    // came from its answer; other new commands leave it open (handled by the
    // caller passing resolveClarification).
    await enqueueReply(tx, ctx, replyText, "confirmation");
    return { replyText };
  });
}

/** Persist a clarification question (superseding any open one) and enqueue it. */
export async function executeClarification(
  sql: Sql,
  ctx: AgentContext,
  missingField: string,
  question: string,
  draft: StructuredOutput,
): Promise<ExecutionResult> {
  return await sql.begin(async (tx) => {
    await tx`
      update pending_clarifications
         set state = 'cancelled', resolved_at = now()
       where household_id = ${ctx.household.id} and state = 'open'
    `;
    const rows = await tx<{ id: string }[]>`
      insert into pending_clarifications
        (household_id, requester_member_id, draft_action, missing_field, question_text)
      values
        (${ctx.household.id}, ${ctx.sender.id}, ${sql.json(draft as never)},
         ${missingField}, ${question})
      returning id
    `;
    const replyText = composeClarification(ctx, question);
    await enqueueReply(tx, ctx, replyText, "clarification", `clarification:${rows[0].id}`);
    return { replyText };
  });
}

/** Mark the open clarification answered (called when its answer executed). */
export async function resolveOpenClarification(sql: Sql, householdId: string): Promise<void> {
  await sql`
    update pending_clarifications
       set state = 'answered', resolved_at = now()
     where household_id = ${householdId} and state = 'open'
  `;
}

export async function enqueueReply(
  tx: Sql,
  ctx: AgentContext,
  text: string,
  messageType: "confirmation" | "clarification" | "onboarding" | "system",
  dedupeKey?: string,
): Promise<void> {
  await tx`
    insert into outbox
      (bridge_id, channel_id, household_id, chat_guid, message_type, message_text, dedupe_key)
    values
      (${ctx.channel.bridge_id}, ${ctx.channel.id}, ${ctx.household.id},
       ${ctx.channel.chat_guid}, ${messageType}, ${text},
       ${dedupeKey ?? `${messageType}:${ctx.inboundMessageId}`})
    on conflict (dedupe_key) do nothing
  `;
}

// ── Domain functions (typed, household-scoped) ──────────────────────

interface TaskRecord {
  id: string; short_code: string; title: string;
  assignee_member_id: string | null; due_at: string | null;
}

async function createTask(
  tx: Sql,
  ctx: AgentContext,
  a: Extract<ValidatedAction, { type: "create_task" }>,
): Promise<TaskRecord> {
  const rows = await tx<TaskRecord[]>`
    insert into tasks
      (household_id, title, assignee_member_id, created_by_member_id, due_at, source_message_id)
    values
      (${ctx.household.id}, ${a.title}, ${a.assigneeMemberId}, ${ctx.sender.id},
       ${a.dueAt}, ${ctx.inboundMessageId})
    returning id, short_code, title, assignee_member_id, due_at
  `;
  const task = rows[0];
  if (task.due_at) await syncTaskReminder(tx, ctx, task);
  return task;
}

async function updateTask(
  tx: Sql,
  ctx: AgentContext,
  a: Extract<ValidatedAction, { type: "update_task" }>,
): Promise<TaskRecord> {
  const rows = await tx<TaskRecord[]>`
    update tasks set
      title = coalesce(${a.title}, title),
      assignee_member_id = ${a.assigneeMemberId === undefined ? tx`assignee_member_id` : a.assigneeMemberId},
      due_at = ${a.dueAt === undefined ? tx`due_at` : a.dueAt}
    where id = ${a.task.id} and household_id = ${ctx.household.id}
    returning id, short_code, title, assignee_member_id, due_at
  `;
  const task = rows[0];
  await cancelTaskReminders(tx, task.id);
  if (task.due_at) await syncTaskReminder(tx, ctx, task);
  return task;
}

async function completeTask(tx: Sql, ctx: AgentContext, taskId: string): Promise<TaskRecord> {
  const rows = await tx<TaskRecord[]>`
    update tasks set status = 'done', completed_at = now()
    where id = ${taskId} and household_id = ${ctx.household.id}
    returning id, short_code, title, assignee_member_id, due_at
  `;
  await cancelTaskReminders(tx, taskId);
  return rows[0];
}

async function cancelTask(tx: Sql, ctx: AgentContext, taskId: string): Promise<TaskRecord> {
  const rows = await tx<TaskRecord[]>`
    update tasks set status = 'cancelled', cancelled_at = now()
    where id = ${taskId} and household_id = ${ctx.household.id}
    returning id, short_code, title, assignee_member_id, due_at
  `;
  await cancelTaskReminders(tx, taskId);
  return rows[0];
}

async function cancelAllTasks(tx: Sql, ctx: AgentContext): Promise<number> {
  const rows = await tx<{ id: string }[]>`
    update tasks set status = 'cancelled', cancelled_at = now()
    where household_id = ${ctx.household.id} and status = 'open'
    returning id
  `;
  for (const r of rows) await cancelTaskReminders(tx, r.id);
  return rows.length;
}

async function syncTaskReminder(tx: Sql, ctx: AgentContext, task: TaskRecord): Promise<void> {
  if (!task.due_at) return;
  const fireAt = new Date(task.due_at);
  if (fireAt.getTime() <= Date.now()) return;
  await tx`
    insert into reminders (household_id, task_id, assignee_member_id, fire_at, dedupe_key)
    values (${ctx.household.id}, ${task.id}, ${task.assignee_member_id},
            ${fireAt}, ${`task:${task.id}:due:${fireAt.toISOString()}`})
    on conflict (dedupe_key) do nothing
  `;
}

async function cancelTaskReminders(tx: Sql, taskId: string): Promise<void> {
  await tx`
    update reminders set state = 'cancelled'
    where task_id = ${taskId} and state in ('pending', 'enqueued')
  `;
}

interface EventRecord {
  id: string; short_code: string; title: string;
  starts_at: string; ends_at: string | null; location: string | null;
}

async function createEvent(
  tx: Sql,
  ctx: AgentContext,
  a: Extract<ValidatedAction, { type: "create_event" }>,
): Promise<EventRecord> {
  const rows = await tx<EventRecord[]>`
    insert into events
      (household_id, title, starts_at, ends_at, location, created_by_member_id, source_message_id)
    values
      (${ctx.household.id}, ${a.title}, ${a.startsAt}, ${a.endsAt}, ${a.location},
       ${ctx.sender.id}, ${ctx.inboundMessageId})
    returning id, short_code, title, starts_at, ends_at, location
  `;
  const event = rows[0];
  await syncEventReminder(tx, ctx, event);
  return event;
}

async function updateEvent(
  tx: Sql,
  ctx: AgentContext,
  a: Extract<ValidatedAction, { type: "update_event" }>,
): Promise<EventRecord> {
  const rows = await tx<EventRecord[]>`
    update events set
      title = coalesce(${a.title}, title),
      starts_at = ${a.startsAt === undefined ? tx`starts_at` : a.startsAt},
      ends_at = ${a.endsAt === undefined ? tx`ends_at` : a.endsAt},
      location = ${a.location === undefined ? tx`location` : a.location}
    where id = ${a.event.id} and household_id = ${ctx.household.id}
    returning id, short_code, title, starts_at, ends_at, location
  `;
  const event = rows[0];
  await cancelEventReminders(tx, event.id);
  await syncEventReminder(tx, ctx, event);
  return event;
}

async function cancelEvent(tx: Sql, ctx: AgentContext, eventId: string): Promise<EventRecord> {
  const rows = await tx<EventRecord[]>`
    update events set status = 'cancelled'
    where id = ${eventId} and household_id = ${ctx.household.id}
    returning id, short_code, title, starts_at, ends_at, location
  `;
  await cancelEventReminders(tx, eventId);
  return rows[0];
}

async function syncEventReminder(tx: Sql, ctx: AgentContext, event: EventRecord): Promise<void> {
  const offsetMs = ctx.household.before_event_offset_minutes * 60 * 1000;
  const fireAt = new Date(new Date(event.starts_at).getTime() - offsetMs);
  if (fireAt.getTime() <= Date.now()) return;
  await tx`
    insert into reminders (household_id, event_id, fire_at, dedupe_key)
    values (${ctx.household.id}, ${event.id}, ${fireAt},
            ${`event:${event.id}:before:${fireAt.toISOString()}`})
    on conflict (dedupe_key) do nothing
  `;
}

async function cancelEventReminders(tx: Sql, eventId: string): Promise<void> {
  await tx`
    update reminders set state = 'cancelled'
    where event_id = ${eventId} and state in ('pending', 'enqueued')
  `;
}
