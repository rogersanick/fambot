import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  uuid,
  integer,
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Better Auth tables (names/columns per better-auth drizzle adapter defaults)
// ---------------------------------------------------------------------------

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Households and identity
// ---------------------------------------------------------------------------

export const households = pgTable("households", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("America/New_York"),
  botName: text("bot_name").notNull().default("fambot"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    /** Linked app account; family members without accounts have null. */
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    displayName: text("display_name").notNull(),
    role: text("role", { enum: ["owner", "member"] }).notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("members_household_user_uq").on(t.householdId, t.userId),
    uniqueIndex("members_user_uq").on(t.userId),
  ]
);

/** Channel identities (iMessage handles, emails) belonging to household members. */
export const identities = pgTable(
  "identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    type: text("type", { enum: ["imessage", "email", "phone"] }).notNull(),
    value: text("value").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("identities_type_value_uq").on(t.type, t.value)]
);

/** One-time account claim sent to a phone-only household member. */
export const householdInvites = pgTable(
  "household_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    invitedByMemberId: uuid("invited_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    /** SHA-256 digest; the bearer token itself only exists in the SMS URL. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    smsStatus: text("sms_status", {
      enum: ["pending", "queued", "sent", "delivered", "failed"],
    })
      .notNull()
      .default("pending"),
    providerMessageId: text("provider_message_id"),
    sendError: text("send_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("household_invites_member_uq").on(t.memberId),
    uniqueIndex("household_invites_token_hash_uq").on(t.tokenHash),
    index("household_invites_provider_msg_idx").on(t.providerMessageId),
  ]
);

// ---------------------------------------------------------------------------
// Conversations and messages
// ---------------------------------------------------------------------------

export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: ["imessage", "app_chat", "sms"] }).notNull(),
    /** imsg chat_guid / E.164 phone for sms; null for app_chat conversations. */
    externalId: text("external_id"),
    kind: text("kind", { enum: ["direct", "group"] }).notNull().default("direct"),
    name: text("name"),
    /** For app_chat: the member this chat belongs to. */
    ownerMemberId: uuid("owner_member_id").references(() => members.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("conversations_channel_external_uq").on(t.channel, t.externalId)]
);

export const conversationParticipants = pgTable(
  "conversation_participants",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("conv_participants_uq").on(t.conversationId, t.memberId)]
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    senderMemberId: uuid("sender_member_id").references(() => members.id, { onDelete: "set null" }),
    direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
    channel: text("channel", { enum: ["imessage", "app_chat", "sms"] }).notNull(),
    externalMessageId: text("external_message_id"),
    text: text("text").notNull(),
    /**
     * "message" = regular conversation turn; "progress" = transient agent
     * status update shown to the user but excluded from future model context.
     */
    kind: text("kind", { enum: ["message", "progress"] }).notNull().default("message"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("messages_channel_external_uq").on(t.channel, t.externalMessageId),
    index("messages_conversation_idx").on(t.conversationId, t.sentAt),
  ]
);

// ---------------------------------------------------------------------------
// Lists / tasks / reminders / events
// ---------------------------------------------------------------------------

export const lists = pgTable(
  "lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdByMemberId: uuid("created_by_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("lists_household_name_uq").on(t.householdId, t.name)]
);

/**
 * Recurring task templates. The worker materializes concrete task rows
 * (occurrences) on their fixed schedule — whether or not earlier occurrences
 * are still open. `nextOccurrenceAt` is the generation cursor; null with
 * status "exhausted" means the rule (COUNT/UNTIL) ran out. No COUNT/UNTIL
 * in the RRULE means the series recurs in perpetuity until cancelled.
 */
export const taskSeries = pgTable(
  "task_series",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    listId: uuid("list_id").references(() => lists.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    notes: text("notes"),
    assigneeMemberId: uuid("assignee_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    creatorMemberId: uuid("creator_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    /** Where nudges for spawned occurrences are delivered. */
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    rrule: text("rrule").notNull(),
    timezone: text("timezone").notNull(),
    /** First occurrence; anchors the recurrence in local wall-clock space. */
    anchorAt: timestamp("anchor_at", { withTimezone: true }).notNull(),
    nagIntervalMin: integer("nag_interval_min").notNull().default(30),
    /** Next occurrence to materialize; null once exhausted/cancelled. */
    nextOccurrenceAt: timestamp("next_occurrence_at", { withTimezone: true }),
    status: text("status", { enum: ["active", "exhausted", "cancelled"] })
      .notNull()
      .default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("task_series_spawn_idx").on(t.status, t.nextOccurrenceAt)]
);

/**
 * Tasks MUST be completed. From due_at the worker nudges every
 * nagIntervalMin minutes until status leaves "open".
 */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    listId: uuid("list_id").references(() => lists.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    notes: text("notes"),
    status: text("status", { enum: ["open", "done", "cancelled"] }).notNull().default("open"),
    assigneeMemberId: uuid("assignee_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    creatorMemberId: uuid("creator_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    /** Where nudges are delivered (originating conversation). */
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    rrule: text("rrule"),
    timezone: text("timezone"),
    nagIntervalMin: integer("nag_interval_min").notNull().default(30),
    nextNudgeAt: timestamp("next_nudge_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /** Series this occurrence was spawned from (null for one-off tasks). */
    seriesId: uuid("series_id").references(() => taskSeries.id, { onDelete: "set null" }),
    /**
     * Immutable recurrence slot this occurrence was generated for. `dueAt`
     * stays the mutable effective deadline (postponing moves dueAt only).
     */
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("tasks_nudge_idx").on(t.status, t.nextNudgeAt),
    // Idempotent occurrence generation: one row per (series, slot).
    uniqueIndex("tasks_series_slot_uq").on(t.seriesId, t.scheduledFor),
  ]
);

/** Reminders are fire-and-forget: delivered once per occurrence, no completion. */
export const reminders = pgTable(
  "reminders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    creatorMemberId: uuid("creator_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    targetType: text("target_type", { enum: ["member", "conversation"] }).notNull(),
    targetMemberId: uuid("target_member_id").references(() => members.id, { onDelete: "cascade" }),
    targetConversationId: uuid("target_conversation_id").references(() => conversations.id, {
      onDelete: "cascade",
    }),
    fireAt: timestamp("fire_at", { withTimezone: true }),
    rrule: text("rrule"),
    timezone: text("timezone").notNull(),
    nextFireAt: timestamp("next_fire_at", { withTimezone: true }),
    status: text("status", { enum: ["scheduled", "done", "cancelled"] })
      .notNull()
      .default("scheduled"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reminders_fire_idx").on(t.status, t.nextFireAt)]
);

/**
 * Calendar events. A row with an rrule is a recurring series: startsAt/endsAt
 * describe the first occurrence and the series is expanded on read for the
 * requested range (never materialized). No COUNT/UNTIL = forever.
 */
export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  creatorMemberId: uuid("creator_member_id").references(() => members.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  location: text("location"),
  notes: text("notes"),
  rrule: text("rrule"),
  /** Required when rrule is set (recurrence math is wall-clock local). */
  timezone: text("timezone"),
  source: text("source", { enum: ["internal", "google"] }).notNull().default("internal"),
  externalId: text("external_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Comment threads on tasks, events, and lists. Exactly one subject FK is set
 * per row (enforced by check constraint). Append-only: comments are the
 * running status log for an item, visible to the whole household.
 */
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "cascade" }),
    listId: uuid("list_id").references(() => lists.id, { onDelete: "cascade" }),
    authorMemberId: uuid("author_member_id").references(() => members.id, {
      onDelete: "set null",
    }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("comments_task_idx").on(t.taskId, t.createdAt),
    index("comments_event_idx").on(t.eventId, t.createdAt),
    index("comments_list_idx").on(t.listId, t.createdAt),
    check(
      "comments_one_subject_ck",
      sql`num_nonnulls(${t.taskId}, ${t.eventId}, ${t.listId}) = 1`
    ),
  ]
);

// ---------------------------------------------------------------------------
// Delivery / outbox / integrations
// ---------------------------------------------------------------------------

/** Audit of every reminder fire and task nudge (prevents double delivery). */
/**
 * One row per notification occurrence, recipient, and channel. `dedupeKey` is
 * deterministic (`kind:sourceId:occurrence:channel:recipient`) and unique, so
 * a crashed worker re-claiming the same occurrence can never double-send.
 * Status lifecycle: pending → queued (provider accepted) → sent → delivered;
 * terminal alternatives are failed and skipped (e.g. member has no phone).
 */
export const deliveries = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind", { enum: ["reminder", "task_nudge"] }).notNull(),
    reminderId: uuid("reminder_id").references(() => reminders.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    memberId: uuid("member_id").references(() => members.id, { onDelete: "set null" }),
    channel: text("channel", { enum: ["sms", "imessage"] }).notNull(),
    /** Deterministic per occurrence+channel+recipient; unique = at-most-once send. */
    dedupeKey: text("dedupe_key").notNull(),
    /** Snapshot of the destination address (E.164 phone or imsg chat_guid). */
    recipientAddress: text("recipient_address"),
    /** Provider-side message id (Telnyx message id) for webhook status updates. */
    providerMessageId: text("provider_message_id"),
    status: text("status", {
      enum: ["pending", "queued", "sent", "delivered", "failed", "skipped"],
    })
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    error: text("error"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("deliveries_task_idx").on(t.taskId, t.createdAt),
    uniqueIndex("deliveries_dedupe_uq").on(t.dedupeKey),
    index("deliveries_provider_msg_idx").on(t.providerMessageId),
  ]
);

/** Outbound iMessage queue; the Mac bridge consumes over WebSocket and acks. */
export const outboxMessages = pgTable(
  "outbox_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    /** Scheduled-notification delivery this outbox row fulfils; the bridge ack updates it. */
    deliveryId: uuid("delivery_id").references(() => deliveries.id, { onDelete: "set null" }),
    chatGuid: text("chat_guid").notNull(),
    text: text("text").notNull(),
    status: text("status", { enum: ["pending", "sending", "sent", "failed"] })
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    externalMessageId: text("external_message_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [index("outbox_status_idx").on(t.status, t.createdAt)]
);

// ---------------------------------------------------------------------------
// Notification channels
// ---------------------------------------------------------------------------

/**
 * Which notification surfaces a household broadcasts scheduled reminders and
 * task nudges to. One row per (household, channel); every enabled channel
 * receives every notification. Web chat is intentionally not represented —
 * it is an interaction surface, never a notification destination.
 */
export const householdNotificationChannels = pgTable(
  "household_notification_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: ["sms", "imessage"] }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    /** For imessage: the household conversation notifications are delivered into. */
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("household_channel_uq").on(t.householdId, t.channel)]
);

/**
 * Durable inbound queue for Telnyx webhooks. The HTTP handler verifies the
 * signature, inserts (deduped on Telnyx event id), and acknowledges within
 * Telnyx's two-second window; a background drain processes rows afterwards.
 */
export const telnyxEvents = pgTable(
  "telnyx_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status", { enum: ["pending", "processed", "failed"] })
      .notNull()
      .default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("telnyx_events_event_uq").on(t.eventId),
    index("telnyx_events_status_idx").on(t.status, t.createdAt),
  ]
);

export const calendarConnections = pgTable(
  "calendar_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["google"] }).notNull().default("google"),
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    calendarId: text("calendar_id").notNull().default("primary"),
    accountEmail: text("account_email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("calendar_conn_user_provider_uq").on(t.userId, t.provider)]
);

// ---------------------------------------------------------------------------
// AI audit trail
// ---------------------------------------------------------------------------

export const aiRuns = pgTable("ai_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  latencyMs: integer("latency_ms"),
  status: text("status", { enum: ["ok", "invalid_output", "error"] }).notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const actionExecutions = pgTable("action_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  aiRunId: uuid("ai_run_id").references(() => aiRuns.id, { onDelete: "cascade" }),
  actionType: text("action_type").notNull(),
  argumentsJson: jsonb("arguments_json").notNull(),
  resultJson: jsonb("result_json"),
  status: text("status", {
    enum: ["executed", "rejected", "clarify", "failed"],
  }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Idempotency ledger for mutating MCP tool calls. A retried call with the
 * same (household, key) returns the stored result instead of re-executing,
 * so model/tool-loop retries can never duplicate rows.
 */
export const mcpToolCalls = pgTable(
  "mcp_tool_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    householdId: uuid("household_id")
      .notNull()
      .references(() => households.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    toolName: text("tool_name").notNull(),
    resultJson: jsonb("result_json").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("mcp_tool_calls_household_key_uq").on(t.householdId, t.idempotencyKey)]
);

/** Confirmations: "yes" executes a stored pending action if context matches. */
export const pendingActions = pgTable("pending_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  householdId: uuid("household_id")
    .notNull()
    .references(() => households.id, { onDelete: "cascade" }),
  memberId: uuid("member_id").references(() => members.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, {
    onDelete: "cascade",
  }),
  actionJson: jsonb("action_json").notNull(),
  status: text("status", { enum: ["pending", "confirmed", "expired", "cancelled"] })
    .notNull()
    .default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
