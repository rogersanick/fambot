import { and, desc, eq, ne } from "drizzle-orm";
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
import { toLocalIso } from "@fambot/domain";
import { ProgressReporter } from "@fambot/ai";
import {
  getOrCreateSmsConversation,
  getOrCreateSmsGroupConversation,
} from "@fambot/messaging";
import { ai, channelRouter, db } from "./context";
import { env } from "./env";
import { mintMcpToken } from "./mcp-auth";

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

  // 5. Agent loop over MCP tools. Progress + the final reply go back on
  // the originating conversation (SMS → that SMS thread, chat → chat).
  const requestId = crypto.randomUUID();
  const token = await mintMcpToken({
    memberId: actor.id,
    householdId: household.id,
    conversationId: conversation.id,
    source: "agent",
    requestId,
  });
  const progress = new ProgressReporter({
    send: (text) =>
      channelRouter.sendMessage({ conversationId: conversation.id, text, kind: "progress" }),
  });
  const result = await ai.runAgent({
    mcp: {
      url: `${env.API_BASE_URL.replace(/\/$/, "")}/mcp`,
      headers: { authorization: `Bearer ${token}` },
    },
    input: {
      nowLocal: toLocalIso(new Date(), household.timezone),
      timezone: household.timezone,
      senderName: actor.displayName,
      participantNames: (participants.length ? participants : householdMembers).map((m) => m.displayName),
      isGroup: inbound.context.isGroup,
      recentTurns,
      text: matcher.strip(inbound.text),
    },
    onToolStep: (step) => progress.onToolStep(step),
  });

  const [run] = await db
    .insert(aiRuns)
    .values({
      messageId,
      provider: result.meta.provider,
      model: result.meta.model,
      inputTokens: result.meta.inputTokens,
      outputTokens: result.meta.outputTokens,
      latencyMs: result.meta.latencyMs,
      status: result.meta.status,
      error: result.meta.error,
    })
    .returning({ id: aiRuns.id });

  if (run && result.steps.length > 0) {
    await db.insert(actionExecutions).values(
      result.steps.map((step) => ({
        aiRunId: run.id,
        actionType: step.toolName,
        argumentsJson: step.args,
        resultJson: { message: step.message, data: step.data },
        status: step.status,
      }))
    );
  }

  if (result.reply) {
    await channelRouter.sendMessage({ conversationId: conversation.id, text: result.reply });
  }

  return {
    conversationId: conversation.id,
    persistedMessageId: messageId,
    invoked: true,
    reply: result.reply || null,
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

  if (inbound.channel === "sms") {
    // SMS: identify the household by sender. Group MMS additionally proves
    // that every handset participant belongs to the same household.
    // Unknown numbers are ignored — only household members can text Fambot.
    const [identity] = await db
      .select({ memberId: identities.memberId })
      .from(identities)
      .where(and(eq(identities.type, "phone"), eq(identities.value, inbound.sender.externalId)));
    if (!identity) {
      console.warn(`[pipeline] ignoring SMS from unknown number ${inbound.sender.externalId}`);
      return null;
    }
    const [senderMember] = await db.select().from(members).where(eq(members.id, identity.memberId));
    if (!senderMember) return null;
    const [household] = await db
      .select()
      .from(households)
      .where(eq(households.id, senderMember.householdId));
    if (!household) return null;
    if (inbound.context.isGroup) {
      const participantPhones = new Set([
        inbound.sender.externalId,
        ...(inbound.participantExternalIds ?? []),
      ]);
      const householdPhones = await db
        .select({ phone: identities.value })
        .from(identities)
        .innerJoin(members, eq(identities.memberId, members.id))
        .where(
          and(eq(identities.type, "phone"), eq(members.householdId, household.id))
        );
      const expected = new Set(householdPhones.map(({ phone }) => phone));
      if (
        participantPhones.size !== expected.size ||
        [...participantPhones].some((phone) => !expected.has(phone))
      ) {
        console.warn("[pipeline] ignoring SMS group with unknown or missing household participants");
        return null;
      }
      const conversationId = await getOrCreateSmsGroupConversation(db, household.id);
      if (!conversationId) return null;
      const [conversation] = await db
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId));
      if (!conversation) return null;
      return { conversation, household, senderMember };
    }
    console.log(
      `[pipeline] SMS from ${inbound.sender.externalId} (${senderMember.displayName}) → ${household.name}`
    );
    const conversationId = await getOrCreateSmsConversation(db, {
      householdId: household.id,
      memberId: senderMember.id,
      phone: inbound.sender.externalId,
      displayName: senderMember.displayName,
    });
    const [conversation] = await db
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!conversation) return null;
    return { conversation, household, senderMember };
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
    .where(and(eq(messages.conversationId, conversationId), ne(messages.kind, "progress")))
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
