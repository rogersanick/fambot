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
    index("members_user_idx").on(t.userId),
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
    channel: text("channel", { enum: ["imessage", "app_chat"] }).notNull(),
    /** imsg chat_guid; null for app_chat conversations. */
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
    channel: text("channel", { enum: ["imessage", "app_chat"] }).notNull(),
    externalMessageId: text("external_message_id"),
    text: text("text").notNull(),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tasks_nudge_idx").on(t.status, t.nextNudgeAt)]
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
  source: text("source", { enum: ["internal", "google"] }).notNull().default("internal"),
  externalId: text("external_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Delivery / outbox / integrations
// ---------------------------------------------------------------------------

/** Audit of every reminder fire and task nudge (prevents double delivery). */
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
    channel: text("channel", { enum: ["imessage", "app_chat"] }).notNull(),
    status: text("status", { enum: ["pending", "sent", "failed"] }).notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    error: text("error"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deliveries_task_idx").on(t.taskId, t.createdAt)]
);

/** Outbound iMessage queue; the Mac bridge consumes over WebSocket and acks. */
export const outboxMessages = pgTable(
  "outbox_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
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
