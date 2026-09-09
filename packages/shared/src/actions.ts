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

export const CreateReminderSchema = z.object({
  type: z.literal("create_reminder"),
  title: z.string().min(1),
  /** Local wall-clock time of the (first) fire. Null only if rrule fully specifies it. */
  fire_at: localDateTime.nullable(),
  /** RFC-5545 recurrence rule, null for one-shot reminders. */
  rrule: z.string().nullable(),
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
});

export const CancelReminderSchema = z.object({
  type: z.literal("cancel_reminder"),
  reminder_ref: z.string().min(1),
});

export const CreateTaskSchema = z.object({
  type: z.literal("create_task"),
  title: z.string().min(1),
  /** When the task is due and nagging starts. Null = unscheduled (no nagging). */
  due_at: localDateTime.nullable(),
  rrule: z.string().nullable(),
  /** Minutes between nudges after due_at until completed. Null = default. */
  nag_interval_minutes: z.number().int().min(5).max(24 * 60).nullable(),
  assignee_name: z.string().nullable(),
  list_name: z.string().nullable(),
});

export const UpdateTaskSchema = z.object({
  type: z.literal("update_task"),
  task_ref: z.string().min(1),
  new_title: z.string().nullable(),
  new_due_at: localDateTime.nullable(),
  new_list_name: z.string().nullable(),
});

export const CompleteTaskSchema = z.object({
  type: z.literal("complete_task"),
  /** Null = the most recently nudged open task in this conversation. */
  task_ref: z.string().nullable(),
});

export const CancelTaskSchema = z.object({
  type: z.literal("cancel_task"),
  task_ref: z.string().min(1),
});

export const CreateListSchema = z.object({
  type: z.literal("create_list"),
  name: z.string().min(1),
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

export const CreateEventSchema = z.object({
  type: z.literal("create_event"),
  title: z.string().min(1),
  start_at: localDateTime,
  end_at: localDateTime.nullable(),
  location: z.string().nullable(),
  attendee_names: z.array(z.string()).nullable(),
});

export const SearchScheduleSchema = z.object({
  type: z.literal("search_schedule"),
  /** Local date range to search. Nulls default to "the next 7 days". */
  start_at: localDateTime.nullable(),
  end_at: localDateTime.nullable(),
  query: z.string().nullable(),
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
  CreateListSchema,
  RenameListSchema,
  DeleteListSchema,
  CreateEventSchema,
  SearchScheduleSchema,
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
export type CreateEventAction = z.infer<typeof CreateEventSchema>;
export type SearchScheduleAction = z.infer<typeof SearchScheduleSchema>;
