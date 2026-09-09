import { and, desc, eq, inArray } from "drizzle-orm";
import {
  actionExecutions,
  aiRuns,
  conversationParticipants,
  conversations,
  households,
  identities,
  members,
  messages,
} from "@fambot/database";
import type { InboundMessage, ConversationTurn } from "@fambot/shared";
import { InvocationMatcher, shouldInvokeAssistant } from "@fambot/shared";
import { executeActions, toLocalIso, type ExecutionContext } from "@fambot/domain";
import { GoogleCalendarProvider } from "@fambot/calendar";
import { ai, channelRouter, db, services } from "./context";
import { env, googleEnabled } from "./env";

export type PipelineResult = {
  conversationId: string;
  persistedMessageId: string | null;
  invoked: boolean;
  reply: string | null;
};

/**
 * The single processing pipeline for ALL channels (design doc §2/§37).
 * iMessage webhooks and app chat both land here with a normalized
 * InboundMessage; nothing downstream knows the channel.
 */
export async function processInbound(inbound: InboundMessage): Promise<PipelineResult | null> {
  // 1. Resolve conversation + household
  const resolved = await resolveConversation(inbound);
  if (!resolved) return null; // unroutable (unknown iMessage sender)
  const { conversation, household, senderMember } = resolved;

  // 2. Idempotent persist (unique on channel+external_message_id)
  const inserted = await db
    .insert(messages)
    .values({
      conversationId: conversation.id,
      senderMemberId: senderMember?.id ?? null,
      direction: "inbound",
      channel: inbound.channel,
      externalMessageId: inbound.externalMessageId ?? null,
      text: inbound.text,
      sentAt: new Date(inbound.sentAt),
    })
    .onConflictDoNothing()
    .returning({ id: messages.id });
  if (inbound.externalMessageId && inserted.length === 0) {
    // Redelivered webhook — already processed. Never execute twice.
    return { conversationId: conversation.id, persistedMessageId: null, invoked: false, reply: null };
  }
  const messageId = inserted[0]?.id ?? null;

  // 3. Deterministic trigger detection (mention recomputed with the household's bot name)
  const matcher = new InvocationMatcher(household.botName);
  const withMention: InboundMessage = {
    ...inbound,
    context: { ...inbound.context, botWasMentioned: matcher.matches(inbound.text) },
  };
  if (!shouldInvokeAssistant(withMention)) {
    return { conversationId: conversation.id, persistedMessageId: messageId, invoked: false, reply: null };
  }

  // 4. Context: participants + recent turns
  const householdMembers = await db
    .select({ id: members.id, displayName: members.displayName, role: members.role, userId: members.userId })
    .from(members)
    .where(eq(members.householdId, household.id));
  const participantRows = await db
    .select({ memberId: conversationParticipants.memberId })
    .from(conversationParticipants)
    .where(eq(conversationParticipants.conversationId, conversation.id));
  const participantIds = new Set(participantRows.map((p) => p.memberId));
  const participants = householdMembers.filter((m) => participantIds.has(m.id));
  const recentTurns = await loadRecentTurns(conversation.id, householdMembers);

  const actor = senderMember ?? householdMembers.find((m) => m.role === "owner") ?? householdMembers[0];
  if (!actor) return { conversationId: conversation.id, persistedMessageId: messageId, invoked: false, reply: null };

  // 5. AI interpretation (the model only proposes; it executes nothing)
  const interpretation = await ai.interpret({
    nowLocal: toLocalIso(new Date(), household.timezone),
    timezone: household.timezone,
    senderName: actor.displayName,
    participantNames: (participants.length ? participants : householdMembers).map((m) => m.displayName),
    isGroup: inbound.context.isGroup,
    recentTurns,
    text: matcher.strip(inbound.text),
  });

  const [run] = await db
    .insert(aiRuns)
    .values({
      messageId,
      provider: interpretation.meta.provider,
      model: interpretation.meta.model,
      inputTokens: interpretation.meta.inputTokens,
      outputTokens: interpretation.meta.outputTokens,
      latencyMs: interpretation.meta.latencyMs,
      status: interpretation.meta.status,
      error: interpretation.meta.error,
    })
    .returning({ id: aiRuns.id });

  // 6. Authorization + resolution + execution (deterministic application code)
  const externalCalendar =
    googleEnabled && actor.userId
      ? await GoogleCalendarProvider.forUser(
          db,
          {
            clientId: env.GOOGLE_CLIENT_ID!,
            clientSecret: env.GOOGLE_CLIENT_SECRET!,
            redirectUri: `${env.API_BASE_URL}/api/integrations/google/callback`,
            encryptionKey: env.TOKEN_ENCRYPTION_KEY,
          },
          actor.userId
        )
      : null;

  const ctx: ExecutionContext = {
    db,
    services,
    externalCalendar,
    householdId: household.id,
    timezone: household.timezone,
    actor: {
      memberId: actor.id,
      householdId: household.id,
      role: actor.role as "owner" | "member",
      displayName: actor.displayName,
    },
    conversation: {
      id: conversation.id,
      kind: conversation.kind as "direct" | "group",
      channel: conversation.channel as "imessage" | "app_chat",
    },
    participants,
    householdMembers,
  };

  const outcome = await executeActions(ctx, interpretation.actions);

  if (run) {
    await db.insert(actionExecutions).values(
      outcome.executions.map((e) => ({
        aiRunId: run.id,
        actionType: e.actionType,
        argumentsJson: e.args,
        resultJson: e.result ?? null,
        status: e.status,
      }))
    );
  }

  // 7. Respond through the originating channel
  if (outcome.reply) {
    await channelRouter.sendMessage({ conversationId: conversation.id, text: outcome.reply });
  }

  return {
    conversationId: conversation.id,
    persistedMessageId: messageId,
    invoked: true,
    reply: outcome.reply || null,
  };
}

// ---------------------------------------------------------------------------

async function resolveConversation(inbound: InboundMessage) {
  if (inbound.channel === "app_chat") {
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, inbound.conversationExternalId));
    if (!conversation) return null;
    const [household] = await db
      .select()
      .from(households)
      .where(eq(households.id, conversation.householdId));
    if (!household) return null;
    const [senderMember] = await db
      .select()
      .from(members)
      .where(eq(members.id, inbound.sender.externalId));
    return { conversation, household, senderMember: senderMember ?? null };
  }

  // iMessage: find existing conversation by chat_guid
  const [existing] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.channel, "imessage"), eq(conversations.externalId, inbound.conversationExternalId)));

  // Sender identity → member
  const [identity] = await db
    .select({ memberId: identities.memberId })
    .from(identities)
    .where(and(eq(identities.type, "imessage"), eq(identities.value, inbound.sender.externalId)));
  const senderMember = identity
    ? (await db.select().from(members).where(eq(members.id, identity.memberId)))[0] ?? null
    : null;

  if (existing) {
    const [household] = await db.select().from(households).where(eq(households.id, existing.householdId));
    if (!household) return null;
    return { conversation: existing, household, senderMember };
  }

  // Unknown chat: auto-map via the sender's identity. Unknown sender → ignore.
  if (!senderMember) {
    console.warn(`[pipeline] ignoring message from unknown iMessage handle ${inbound.sender.externalId}`);
    return null;
  }
  const [household] = await db.select().from(households).where(eq(households.id, senderMember.householdId));
  if (!household) return null;
  const [conversation] = await db
    .insert(conversations)
    .values({
      householdId: household.id,
      channel: "imessage",
      externalId: inbound.conversationExternalId,
      kind: inbound.context.isGroup ? "group" : "direct",
      name: inbound.context.isGroup ? "iMessage group" : `iMessage with ${senderMember.displayName}`,
    })
    .returning();
  await db
    .insert(conversationParticipants)
    .values({ conversationId: conversation!.id, memberId: senderMember.id })
    .onConflictDoNothing();
  return { conversation: conversation!, household, senderMember };
}

async function loadRecentTurns(
  conversationId: string,
  householdMembers: Array<{ id: string; displayName: string }>
): Promise<ConversationTurn[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.sentAt))
    .limit(15);
  const nameOf = new Map(householdMembers.map((m) => [m.id, m.displayName]));
  return rows.reverse().map((m) => ({
    sender: m.direction === "outbound" ? "Fambot" : (nameOf.get(m.senderMemberId ?? "") ?? "Someone"),
    isBot: m.direction === "outbound",
    text: m.text,
    at: m.sentAt.toISOString(),
  }));
}
