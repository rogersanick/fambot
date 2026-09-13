import { z } from "zod";
import {
  AddCommentSchema,
  AddListItemsSchema,
  CancelReminderSchema,
  CancelTaskSchema,
  CompleteTaskSchema,
  CreateEventSchema,
  CreateListSchema,
  CreateReminderSchema,
  CreateTaskSchema,
  DeleteListItemSchema,
  DeleteListSchema,
  GetCommentStatusSchema,
  GetListSchema,
  RenameListSchema,
  SearchScheduleSchema,
  SetListItemCompletedSchema,
  UpdateListItemSchema,
  UpdateReminderSchema,
  UpdateTaskSchema,
  type ProposedAction,
} from "@fambot/shared";
import {
  executeSingleAction,
  resolveLocalDateTime,
  toLocalIso,
  type ExecutionContext,
} from "@fambot/domain";
import { executed, type ToolResult } from "./result";

/**
 * One Fambot MCP tool: a Zod input contract plus a household-scoped handler.
 * Handlers only ever call the domain layer (executor/services) — never
 * tables — so authorization and scoping stay centralized.
 */
export type ToolDefinition = {
  name: string;
  description: string;
  /** Mutating tools accept an idempotency_key and are replay-protected. */
  mutating: boolean;
  inputSchema: z.ZodObject<z.ZodRawShape>;
  handler: (ctx: ExecutionContext, input: unknown) => Promise<ToolResult>;
};

/** Wrap a ProposedAction schema as a tool: same name, `type` field stripped. */
function actionTool(
  name: ProposedAction["type"],
  description: string,
  schema: z.ZodObject<z.ZodRawShape>,
  mutating: boolean
): ToolDefinition {
  return {
    name,
    description,
    mutating,
    inputSchema: schema.omit({ type: true }) as z.ZodObject<z.ZodRawShape>,
    handler: async (ctx, input) => {
      const action = { ...(input as Record<string, unknown>), type: name } as ProposedAction;
      const result = await executeSingleAction(ctx, action);
      return { status: result.status, message: result.message, data: result.data };
    },
  };
}

const DATETIME_NOTE =
  "Datetimes are local wall-clock ISO strings for the household timezone, e.g. 2026-09-09T08:00:00 (no offset).";

const actionTools: ToolDefinition[] = [
  actionTool(
    "create_reminder",
    `Schedule a fire-and-forget reminder (one-shot or RRULE recurring) for the sender, the whole conversation, or a named household member. ${DATETIME_NOTE}`,
    CreateReminderSchema,
    true
  ),
  actionTool(
    "update_reminder",
    "Update an existing scheduled reminder found by words from its title (reminder_ref). Null fields are left unchanged.",
    UpdateReminderSchema,
    true
  ),
  actionTool(
    "cancel_reminder",
    "Cancel a scheduled reminder found by words from its title.",
    CancelReminderSchema,
    true
  ),
  actionTool(
    "create_task",
    `Create a todo that Fambot nags about from due_at until completed. Use rrule for recurring series. Optional list_name files it on a list. ${DATETIME_NOTE}`,
    CreateTaskSchema,
    true
  ),
  actionTool(
    "update_task",
    "Update an open task found by task_ref. new_due_at postpones only that occurrence; new_rrule changes the whole series; stop_recurrence true stops future occurrences.",
    UpdateTaskSchema,
    true
  ),
  actionTool(
    "complete_task",
    'Mark a task done. task_ref null means "the task most recently nudged in this conversation" (for bare replies like "done").',
    CompleteTaskSchema,
    true
  ),
  actionTool(
    "cancel_task",
    "Cancel an open task. cancel_series true also stops the recurring series it belongs to.",
    CancelTaskSchema,
    true
  ),
  actionTool(
    "create_list",
    "Create a checklist (idempotent on exact name). Optional items are the initial checklist entries.",
    CreateListSchema,
    true
  ),
  actionTool("rename_list", "Rename an existing list found by name words.", RenameListSchema, true),
  actionTool(
    "delete_list",
    "Delete a list (household owner only). Its tasks move back to General.",
    DeleteListSchema,
    true
  ),
  actionTool(
    "add_list_items",
    'Add checklist entries to an existing list. Use this for ordinary list changes like "add milk to groceries" — never add_comment.',
    AddListItemsSchema,
    true
  ),
  actionTool(
    "update_list_item",
    "Rename a single checklist entry (item_ref = words from its current title).",
    UpdateListItemSchema,
    true
  ),
  actionTool(
    "set_list_item_completed",
    'Check or uncheck a checklist entry ("cross milk off groceries").',
    SetListItemCompletedSchema,
    true
  ),
  actionTool("delete_list_item", "Remove an entry from a list.", DeleteListItemSchema, true),
  actionTool("get_list", "Read a list and its entries with completion state.", GetListSchema, false),
  actionTool(
    "create_event",
    `Add a calendar event (synced to Google Calendar when the member has connected it). ${DATETIME_NOTE}`,
    CreateEventSchema,
    true
  ),
  actionTool(
    "search_schedule",
    "Search calendar events in a local date range (defaults to the next 7 days), merged with Google Calendar when connected.",
    SearchScheduleSchema,
    false
  ),
  actionTool(
    "add_comment",
    "Attach a note/status update to an existing task, event, or list. ONLY when the user explicitly asks to add a comment, leave a note, or record a status update. Never use this to add items to a list or to complete work.",
    AddCommentSchema,
    true
  ),
  actionTool(
    "get_comment_status",
    "Read the latest comments/status updates on a task, event, or list. Only for explicit questions about notes, comments, or status updates.",
    GetCommentStatusSchema,
    false
  ),
];

// --- read tools -----------------------------------------------------------------

const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, "expected local ISO datetime like 2026-09-09T08:00:00");

const readTools: ToolDefinition[] = [
  {
    name: "get_context",
    description:
      "Fambot context for this request: household timezone, current local time, the acting member, conversation info, and household members. Call this first when member names or times matter.",
    mutating: false,
    inputSchema: z.object({}),
    handler: async (ctx) =>
      executed("Context loaded.", {
        household: { id: ctx.householdId, timezone: ctx.timezone },
        nowLocal: toLocalIso(new Date(), ctx.timezone),
        actor: {
          memberId: ctx.actor.memberId,
          displayName: ctx.actor.displayName,
          role: ctx.actor.role,
        },
        conversation: ctx.conversation,
        members: ctx.householdMembers.map((m) => ({ id: m.id, displayName: m.displayName })),
      }),
  },
  {
    name: "list_members",
    description: "List the household members (id and display name).",
    mutating: false,
    inputSchema: z.object({}),
    handler: async (ctx) =>
      executed(
        `${ctx.householdMembers.length} member(s).`,
        ctx.householdMembers.map((m) => ({ id: m.id, displayName: m.displayName }))
      ),
  },
  {
    name: "list_lists",
    description: "List all checklists in the household (id and name). Use get_list for entries.",
    mutating: false,
    inputSchema: z.object({}),
    handler: async (ctx) => {
      const rows = await ctx.services.lists.list(ctx.householdId);
      return executed(
        `${rows.length} list(s).`,
        rows.map((l) => ({ id: l.id, name: l.name }))
      );
    },
  },
  {
    name: "list_tasks",
    description:
      "List household tasks/todos (newest first, up to 100). Entries with a listId are checklist items; listId null means a standalone todo.",
    mutating: false,
    inputSchema: z.object({}),
    handler: async (ctx) => {
      const rows = await ctx.services.tasks.list(ctx.householdId);
      return executed(
        `${rows.length} task(s).`,
        rows.slice(0, 100).map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          dueAtLocal: t.dueAt ? toLocalIso(t.dueAt, ctx.timezone) : null,
          listId: t.listId,
          seriesId: t.seriesId,
          assigneeMemberId: t.assigneeMemberId,
        }))
      );
    },
  },
  {
    name: "list_reminders",
    description: "List reminders with their status and next fire time (up to 100).",
    mutating: false,
    inputSchema: z.object({}),
    handler: async (ctx) => {
      const rows = await ctx.services.reminders.list(ctx.householdId);
      return executed(
        `${rows.length} reminder(s).`,
        rows.slice(0, 100).map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          nextFireAtLocal: r.nextFireAt ? toLocalIso(r.nextFireAt, ctx.timezone) : null,
          rrule: r.rrule,
        }))
      );
    },
  },
  {
    name: "list_events",
    description: `List calendar events in a local date range (defaults: now to +30 days). Recurring series are expanded into occurrences. ${DATETIME_NOTE}`,
    mutating: false,
    inputSchema: z.object({
      start_at: localDateTime.nullable(),
      end_at: localDateTime.nullable(),
    }),
    handler: async (ctx, input) => {
      const args = input as { start_at: string | null; end_at: string | null };
      const start = args.start_at ? resolveLocalDateTime(args.start_at, ctx.timezone) : new Date();
      const end = args.end_at
        ? resolveLocalDateTime(args.end_at, ctx.timezone)
        : new Date(start.getTime() + 30 * 86_400_000);
      const rows = await ctx.services.events.listRange(ctx.householdId, start, end);
      return executed(
        `${rows.length} event(s).`,
        rows.map((e) => ({
          id: e.id,
          title: e.title,
          startsAtLocal: toLocalIso(e.startsAt, ctx.timezone),
          endsAtLocal: e.endsAt ? toLocalIso(e.endsAt, ctx.timezone) : null,
          location: e.location,
          recurring: Boolean(e.rrule),
        }))
      );
    },
  },
  {
    name: "get_notification_channels",
    description:
      "Show which household broadcast channels (sms, imessage) are enabled for scheduled reminders and task nudges.",
    mutating: false,
    inputSchema: z.object({}),
    handler: async (ctx) => {
      const rows = await ctx.services.notificationChannels.list(ctx.householdId);
      return executed(`${rows.length} channel(s) configured.`, rows);
    },
  },
];

export const allTools: ToolDefinition[] = [...readTools, ...actionTools];

export const toolByName = new Map(allTools.map((t) => [t.name, t]));
