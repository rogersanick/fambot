export const INTENTS = [
  "SETUP",
  "STOP",
  "HELP",
  "LINK",
  "RENAME_BOT",
  "CREATE_TASK",
  "CREATE_EVENT",
  "UPDATE_TASK",
  "UPDATE_EVENT",
  "COMPLETE_TASK",
  "DELETE_TASK",
  "DELETE_EVENT",
  "LIST_TASKS",
  "LIST_EVENTS",
  "ANSWER_CLARIFICATION",
  "CANCEL_CLARIFICATION",
  "UNKNOWN",
] as const;

export type Intent = (typeof INTENTS)[number];

/** The only shape the model is allowed to emit. */
export interface StructuredOutput {
  intent: Intent;
  title: string | null;
  assignee_reference: string | null;
  due_expression: string | null;
  proposed_due_at: string | null;
  event_start: string | null;
  event_end: string | null;
  event_location: string | null;
  target_reference: string | null;
  new_bot_name: string | null;
  missing_fields: string[];
  clarification_question: string | null;
  clarification_answer_value: string | null;
  reasoning_summary: string;
}

/** Strict JSON schema for the LLM response_format. */
export const STRUCTURED_OUTPUT_SCHEMA = {
  name: "fambot_action",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      intent: { type: "string", enum: [...INTENTS] },
      title: { type: ["string", "null"] },
      assignee_reference: { type: ["string", "null"] },
      due_expression: { type: ["string", "null"] },
      proposed_due_at: { type: ["string", "null"] },
      event_start: { type: ["string", "null"] },
      event_end: { type: ["string", "null"] },
      event_location: { type: ["string", "null"] },
      target_reference: { type: ["string", "null"] },
      new_bot_name: { type: ["string", "null"] },
      missing_fields: { type: "array", items: { type: "string" } },
      clarification_question: { type: ["string", "null"] },
      clarification_answer_value: { type: ["string", "null"] },
      reasoning_summary: { type: "string" },
    },
    required: [
      "intent",
      "title",
      "assignee_reference",
      "due_expression",
      "proposed_due_at",
      "event_start",
      "event_end",
      "event_location",
      "target_reference",
      "new_bot_name",
      "missing_fields",
      "clarification_question",
      "clarification_answer_value",
      "reasoning_summary",
    ],
  },
} as const;

export interface MemberRow {
  id: string;
  normalized_handle: string;
  display_name: string | null;
  aliases: string[];
  removed_at: string | null;
}

export interface HouseholdRow {
  id: string;
  slug: string;
  display_name: string | null;
  invocation_name: string;
  timezone: string | null;
  state: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  morning_default: string;
  afternoon_default: string;
  evening_default: string;
  before_event_offset_minutes: number;
}

export interface TaskRow {
  id: string;
  short_code: string;
  title: string;
  status: string;
  assignee_member_id: string | null;
  due_at: string | null;
}

export interface EventRow {
  id: string;
  short_code: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  location: string | null;
}

export interface ClarificationRow {
  id: string;
  requester_member_id: string | null;
  draft_action: StructuredOutput;
  missing_field: string;
  question_text: string;
}

export interface ContextTurn {
  messageGuid: string;
  senderHandle: string;
  senderName: string | null;
  text: string;
  sentAt: string;
  invokedBot: boolean;
  isFromMe: boolean;
}

export interface ChannelRow {
  id: string;
  household_id: string | null;
  bridge_id: string;
  chat_guid: string;
  state: string;
}

export interface AgentContext {
  household: HouseholdRow;
  channel: ChannelRow;
  sender: MemberRow;
  members: MemberRow[];
  openTasks: TaskRow[];
  upcomingEvents: EventRow[];
  openClarification: ClarificationRow | null;
  recentBotMessages: string[];
  contextTurns: ContextTurn[];
  inboundMessageId: string;
  messageText: string;
  now: Date;
}

/** Result of deterministic validation. */
export type ValidationResult =
  | { kind: "execute"; action: ValidatedAction }
  | { kind: "clarify"; missingField: string; question: string; draft: StructuredOutput }
  | { kind: "error"; message: string }
  | { kind: "refuse"; message: string };

export type ValidatedAction =
  | { type: "create_task"; title: string; assigneeMemberId: string | null; dueAt: Date | null; disclosedDefault: string | null }
  | { type: "update_task"; task: TaskRow; title: string | null; assigneeMemberId: string | null | undefined; dueAt: Date | null | undefined; disclosedDefault: string | null }
  | { type: "complete_task"; task: TaskRow }
  | { type: "delete_task"; task: TaskRow }
  | { type: "delete_all_tasks"; count: number }
  | { type: "create_event"; title: string; startsAt: Date; endsAt: Date | null; location: string | null }
  | { type: "update_event"; event: EventRow; title: string | null; startsAt: Date | undefined; endsAt: Date | null | undefined; location: string | null | undefined }
  | { type: "delete_event"; event: EventRow }
  | { type: "list_tasks" }
  | { type: "list_events" }
  | { type: "rename_bot"; newName: string }
  | { type: "cancel_clarification" }
  | { type: "help" };
