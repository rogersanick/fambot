import { z } from "zod";

/**
 * ProposedAction — the ONLY thing the LLM is allowed to produce.
 *
 * Design notes:
 * - Fields the model may omit are `.nullable()` (not `.optional()`) because
 *   OpenAI structured outputs require every key to be present.
 * - Dates are ISO-8601 *local* wall-clock strings (no offset), e.g.
 *   "2026-09-09T08:00:00". The resolution layer applies the household
 *   timezone and validates the final timestamp. The model never does
 *   timezone math.
 * - Recurrence is an RFC-5545 RRULE string, e.g. "FREQ=WEEKLY;BYDAY=SU".
 */

const localDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/, "expected local ISO datetime like 2026-09-09T08:00:00");

export const TargetSchema = z.enum(["sender", "conversation", "named_person"]);

const NestedChecklistSchema = z.object({
  title: z.string().min(1),
  items: z.array(z.string().min(1)).max(50),
});

const NestedReminderSchema = z.object({
  /** Local wall-clock time of the (first) fire. Null only if rrule fully specifies it. */
  fire_at: localDateTime.nullable(),
  rrule: z.string().nullable(),
});

export const CreateReminderSchema = z.object({
  type: z.literal("create_reminder"),
  title: z.string().min(1),
  /** Local wall-clock time of the (first) fire. Null only if rrule fully specifies it. */
  fire_at: localDateTime.nullable(),
  /** RFC-5545 recurrence rule, null for one-shot reminders. */
  rrule: z.string().nullable(),
  /** Words from an existing task title. Null = infer/create a task from title, unless event_ref is set. */
  task_ref: z.string().nullable(),
  /** Words from an existing event title. Chat infers a Task when both refs are null. */
  event_ref: z.string().nullable(),
  /** Stop repeating when the parent task is completed. Implied for repeating task reminders. */
  until_completed: z.boolean().nullable(),
  target: TargetSchema,
  /** Required when target = named_person. */
  target_name: z.string().nullable(),
});

export const UpdateReminderSchema = z.object({
  type: z.literal("update_reminder"),
  /** Words from the existing reminder's title, used for lookup. */
  reminder_ref: z.string().min(1),
  new_title: z.string().nullable(),
  new_fire_at: localDateTime.nullable(),
  new_rrule: z.string().nullable(),
  /** Re-parent onto an existing task. Null = leave parent unchanged (use link_reminder_* to attach). */
  task_ref: z.string().nullable(),
  /** Re-parent onto an existing event. Null = leave parent unchanged. */
  event_ref: z.string().nullable(),
});

export const CancelReminderSchema = z.object({
  type: z.literal("cancel_reminder"),
  reminder_ref: z.string().min(1),
});

export const CreateTaskSchema = z.object({
  type: z.literal("create_task"),
  title: z.string().min(1),
  /** When the task is due. Null = no deadline. Does not create a reminder by itself. */
  due_at: localDateTime.nullable(),
  rrule: z.string().nullable(),
  assignee_name: z.string().nullable(),
  /** Fresh checklist created with this task (never attaches a standing household list). */
  checklist: NestedChecklistSchema.nullable(),
  /** Attach an existing standing list instead of creating a nested checklist. */
  list_ref: z.string().nullable(),
  /** Reminders attached to this task. Repeating ones stop when the task is completed. */
  reminders: z.array(NestedReminderSchema).max(5).nullable(),
  /** Words from an existing event title to link this task to. */
  event_ref: z.string().nullable(),
});

export const UpdateTaskSchema = z.object({
  type: z.literal("update_task"),
  task_ref: z.string().min(1),
  new_title: z.string().nullable(),
  /** Delays THIS occurrence only; future occurrences keep their schedule. */
  new_due_at: localDateTime.nullable(),
  /** Change/set the recurrence (applies to the whole series). */
  new_rrule: z.string().nullable(),
  /** True = stop future occurrences (keeps the current one). */
  stop_recurrence: z.boolean().nullable(),
});

export const LinkTaskToEventSchema = z.object({
  type: z.literal("link_task_to_event"),
  task_ref: z.string().min(1),
  event_ref: z.string().min(1),
});

export const LinkListToTaskSchema = z.object({
  type: z.literal("link_list_to_task"),
  list_name: z.string().min(1),
  task_ref: z.string().min(1),
});

export const LinkListToEventSchema = z.object({
  type: z.literal("link_list_to_event"),
  list_name: z.string().min(1),
  event_ref: z.string().min(1),
});

export const LinkReminderToTaskSchema = z.object({
  type: z.literal("link_reminder_to_task"),
  reminder_ref: z.string().min(1),
  task_ref: z.string().min(1),
});

export const LinkReminderToEventSchema = z.object({
  type: z.literal("link_reminder_to_event"),
  reminder_ref: z.string().min(1),
  event_ref: z.string().min(1),
});

export const CompleteTaskSchema = z.object({
  type: z.literal("complete_task"),
  /** Null = the most recently nudged open task in this conversation. */
  task_ref: z.string().nullable(),
});

export const CancelTaskSchema = z.object({
  type: z.literal("cancel_task"),
  task_ref: z.string().min(1),
  /** True = cancel the whole recurring series, not just this occurrence. */
  cancel_series: z.boolean().nullable(),
});

export const CreateListSchema = z.object({
  type: z.literal("create_list"),
  name: z.string().min(1),
  /** Optional initial checklist entries. Null creates an empty list. */
  items: z.array(z.string().min(1)).max(50).nullable(),
  /** Words from an existing task title to attach this list to. */
  task_ref: z.string().nullable(),
  /** Words from an existing event title to attach this list to. */
  event_ref: z.string().nullable(),
});

export const RenameListSchema = z.object({
  type: z.literal("rename_list"),
  name: z.string().min(1),
  new_name: z.string().min(1),
});

export const DeleteListSchema = z.object({
  type: z.literal("delete_list"),
  name: z.string().min(1),
});

export const AddListItemsSchema = z.object({
  type: z.literal("add_list_items"),
  list_name: z.string().min(1),
  items: z.array(z.string().min(1)).min(1).max(50),
});

export const UpdateListItemSchema = z.object({
  type: z.literal("update_list_item"),
  list_name: z.string().min(1),
  item_ref: z.string().min(1),
  new_title: z.string().min(1),
});

export const SetListItemCompletedSchema = z.object({
  type: z.literal("set_list_item_completed"),
  list_name: z.string().min(1),
  item_ref: z.string().min(1),
  completed: z.boolean(),
});

export const DeleteListItemSchema = z.object({
  type: z.literal("delete_list_item"),
  list_name: z.string().min(1),
  item_ref: z.string().min(1),
});

export const GetListSchema = z.object({
  type: z.literal("get_list"),
  list_name: z.string().min(1),
});

export const CreateEventSchema = z.object({
  type: z.literal("create_event"),
  title: z.string().min(1),
  /** Event description/body. Reminders are attached objects, not this text. */
  notes: z.string().nullable(),
  start_at: localDateTime,
  end_at: localDateTime.nullable(),
  location: z.string().nullable(),
  attendee_names: z.array(z.string()).nullable(),
  /** RFC-5545 recurrence rule; start_at is the first occurrence. Null = one-off. */
  rrule: z.string().nullable(),
  /** Words from an existing list name to attach to this event. */
  list_ref: z.string().nullable(),
  /** Reminders attached to this event — separate objects with fire times, not the event body. */
  reminders: z.array(NestedReminderSchema).max(5).nullable(),
});

export const SearchScheduleSchema = z.object({
  type: z.literal("search_schedule"),
  /** Local date range to search. Nulls default to "the next 7 days". */
  start_at: localDateTime.nullable(),
  end_at: localDateTime.nullable(),
  query: z.string().nullable(),
});

/** What comments can attach to. Reminders are fire-and-forget — no threads. */
export const CommentSubjectTypeSchema = z.enum(["task", "event", "list"]);

export const AddCommentSchema = z.object({
  type: z.literal("add_comment"),
  subject_type: CommentSubjectTypeSchema,
  /** Words from the item's existing title/name, used for lookup. */
  subject_ref: z.string().min(1),
  /** The status update / note to record on the item. */
  text: z.string().min(1),
});

export const GetCommentStatusSchema = z.object({
  type: z.literal("get_comment_status"),
  subject_type: CommentSubjectTypeSchema,
  subject_ref: z.string().min(1),
});

export const ClarifySchema = z.object({
  type: z.literal("clarify"),
  question: z.string().min(1),
});

export const ChatReplySchema = z.object({
  type: z.literal("chat_reply"),
  text: z.string().min(1),
});

export const ProposedActionSchema = z.discriminatedUnion("type", [
  CreateReminderSchema,
  UpdateReminderSchema,
  CancelReminderSchema,
  CreateTaskSchema,
  UpdateTaskSchema,
  CompleteTaskSchema,
  CancelTaskSchema,
  LinkTaskToEventSchema,
  LinkListToTaskSchema,
  LinkListToEventSchema,
  LinkReminderToTaskSchema,
  LinkReminderToEventSchema,
  CreateListSchema,
  RenameListSchema,
  DeleteListSchema,
  AddListItemsSchema,
  UpdateListItemSchema,
  SetListItemCompletedSchema,
  DeleteListItemSchema,
  GetListSchema,
  CreateEventSchema,
  SearchScheduleSchema,
  AddCommentSchema,
  GetCommentStatusSchema,
  ClarifySchema,
  ChatReplySchema,
]);

/** Envelope the model must return. */
export const InterpretationSchema = z.object({
  actions: z.array(ProposedActionSchema).min(1).max(5),
});

export type ProposedAction = z.infer<typeof ProposedActionSchema>;
export type Interpretation = z.infer<typeof InterpretationSchema>;
export type CreateReminderAction = z.infer<typeof CreateReminderSchema>;
export type CreateTaskAction = z.infer<typeof CreateTaskSchema>;
export type LinkTaskToEventAction = z.infer<typeof LinkTaskToEventSchema>;
export type LinkListToTaskAction = z.infer<typeof LinkListToTaskSchema>;
export type LinkListToEventAction = z.infer<typeof LinkListToEventSchema>;
export type LinkReminderToTaskAction = z.infer<typeof LinkReminderToTaskSchema>;
export type LinkReminderToEventAction = z.infer<typeof LinkReminderToEventSchema>;
export type CreateEventAction = z.infer<typeof CreateEventSchema>;
export type SearchScheduleAction = z.infer<typeof SearchScheduleSchema>;
export type CommentSubjectType = z.infer<typeof CommentSubjectTypeSchema>;
export type AddCommentAction = z.infer<typeof AddCommentSchema>;
export type GetCommentStatusAction = z.infer<typeof GetCommentStatusSchema>;
