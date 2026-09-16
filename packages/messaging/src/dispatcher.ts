import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@fambot/database";
import {
  conversationParticipants,
  conversations,
  deliveries,
  householdNotificationChannels,
  identities,
  members,
  messages,
  outboxMessages,
} from "@fambot/database";
import { TelnyxSmsChannel, getOrCreateSmsConversation } from "./telnyx";

export type NotificationRequest = {
  householdId: string;
  kind: "reminder";
  /** Reminder id. */
  sourceId: string;
  /** Parent task when this notification is about an obligation (so "done" can resolve). */
  taskId?: string | null;
  /** Deterministic occurrence marker (ISO of the scheduled slot). */
  occurrenceKey: string;
  /** Member target and/or the conversation the item originated from. */
  target: { memberId: string | null; conversationId: string | null };
  text: string;
};

export type DispatchOutcome = {
  /** Per-recipient delivery rows created in this dispatch (deduped rows excluded). */
  results: Array<{ channel: "sms" | "imessage"; status: string; recipient: string | null }>;
  /**
   * SMS conversation of the targeted member, when one was used. Reminders
   * about a task store this so a bare SMS "done" resolves to the right task.
   */
  smsConversationId: string | null;
};

type Recipient = { memberId: string; displayName: string; phone: string | null };

/**
 * Broadcast dispatcher for scheduled notifications (design: worker →
 * dispatcher → enabled household channels). Every enabled channel receives
 * every notification; web chat is never a destination. Missing addresses or
 * unconfigured providers produce explicit skipped/failed delivery rows rather
 * than silent fallbacks. Database dedupe (deliveries.dedupeKey) is the
 * authority against double-sends because Telnyx has no idempotency key.
 */
export class NotificationDispatcher {
  constructor(
    private db: Db,
    private opts: {
      telnyx: TelnyxSmsChannel | null;
      /** Wakes the bridge websocket flusher after enqueueing iMessage outbox rows. */
      notifyImsgOutbox?: () => void;
    }
  ) {}

  async dispatch(req: NotificationRequest): Promise<DispatchOutcome> {
    const channels = await this.db
      .select()
      .from(householdNotificationChannels)
      .where(eq(householdNotificationChannels.householdId, req.householdId));
    const sms = channels.find((c) => c.channel === "sms");
    const imsg = channels.find((c) => c.channel === "imessage");

    const outcome: DispatchOutcome = { results: [], smsConversationId: null };
    if (sms?.enabled) await this.dispatchSms(req, outcome);
    if (imsg?.enabled) await this.dispatchImessage(req, imsg.conversationId, outcome);
    return outcome;
  }

  // --- SMS ------------------------------------------------------------------

  private async dispatchSms(req: NotificationRequest, outcome: DispatchOutcome) {
    const recipients = await this.resolveRecipients(req);
    const seenPhones = new Set<string>();

    for (const r of recipients) {
      const dedupeKey = `${req.kind}:${req.sourceId}:${req.occurrenceKey}:sms:${r.memberId}`;

      if (!r.phone) {
        const inserted = await this.insertDelivery(req, {
          channel: "sms",
          dedupeKey,
          memberId: r.memberId,
          status: "skipped",
          error: "member has no phone number",
        });
        if (inserted) outcome.results.push({ channel: "sms", status: "skipped", recipient: null });
        continue;
      }
      if (seenPhones.has(r.phone)) continue;
      seenPhones.add(r.phone);

      if (!this.opts.telnyx) {
        const inserted = await this.insertDelivery(req, {
          channel: "sms",
          dedupeKey,
          memberId: r.memberId,
          recipientAddress: r.phone,
          status: "skipped",
          error: "Telnyx is not configured on the server",
        });
        if (inserted) outcome.results.push({ channel: "sms", status: "skipped", recipient: r.phone });
        continue;
      }

      const deliveryId = await this.insertDelivery(req, {
        channel: "sms",
        dedupeKey,
        memberId: r.memberId,
        recipientAddress: r.phone,
        status: "pending",
      });
      if (!deliveryId) continue; // occurrence already dispatched to this recipient

      const conversationId = await getOrCreateSmsConversation(this.db, {
        householdId: req.householdId,
        memberId: r.memberId,
        phone: r.phone,
        displayName: r.displayName,
      });
      if (req.target.memberId === r.memberId) outcome.smsConversationId = conversationId;

      try {
        const { providerMessageId } = await this.opts.telnyx.sendSms({ to: r.phone, text: req.text });
        // Mirror into the SMS conversation history; the message was already
        // accepted by the provider, so a mirror conflict must not fail it.
        await this.db
          .insert(messages)
          .values({
            conversationId,
            direction: "outbound",
            channel: "sms",
            externalMessageId: providerMessageId || null,
            text: req.text,
            sentAt: new Date(),
          })
          .onConflictDoNothing();
        await this.db
          .update(deliveries)
          .set({ status: "queued", providerMessageId, conversationId, attemptCount: 1 })
          .where(eq(deliveries.id, deliveryId));
        outcome.results.push({ channel: "sms", status: "queued", recipient: r.phone });
      } catch (err) {
        // Ambiguous provider timeouts must not be blindly retried (no
        // idempotency key); record the failure for the delivery audit.
        await this.db
          .update(deliveries)
          .set({
            status: "failed",
            conversationId,
            attemptCount: 1,
            error: err instanceof Error ? err.message : String(err),
          })
          .where(eq(deliveries.id, deliveryId));
        outcome.results.push({ channel: "sms", status: "failed", recipient: r.phone });
      }
    }
  }

  // --- iMessage ---------------------------------------------------------------

  private async dispatchImessage(
    req: NotificationRequest,
    configuredConversationId: string | null,
    outcome: DispatchOutcome
  ) {
    // Prefer the household's configured iMessage conversation; fall back to the
    // originating conversation when it is itself an iMessage thread.
    let conversationId = configuredConversationId;
    if (!conversationId && req.target.conversationId) {
      const [conv] = await this.db
        .select({ id: conversations.id, channel: conversations.channel })
        .from(conversations)
        .where(eq(conversations.id, req.target.conversationId));
      if (conv?.channel === "imessage") conversationId = conv.id;
    }

    const dedupeKey = `${req.kind}:${req.sourceId}:${req.occurrenceKey}:imessage`;

    if (!conversationId) {
      const inserted = await this.insertDelivery(req, {
        channel: "imessage",
        dedupeKey,
        status: "skipped",
        error: "no iMessage conversation configured for household",
      });
      if (inserted) outcome.results.push({ channel: "imessage", status: "skipped", recipient: null });
      return;
    }

    const [conv] = await this.db
      .select({ externalId: conversations.externalId })
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!conv?.externalId) {
      const inserted = await this.insertDelivery(req, {
        channel: "imessage",
        dedupeKey,
        conversationId,
        status: "failed",
        error: "configured conversation has no chat_guid",
      });
      if (inserted) outcome.results.push({ channel: "imessage", status: "failed", recipient: null });
      return;
    }

    const deliveryId = await this.insertDelivery(req, {
      channel: "imessage",
      dedupeKey,
      conversationId,
      recipientAddress: conv.externalId,
      status: "pending",
    });
    if (!deliveryId) return;

    // Delivery stays "pending" until the bridge acks the outbox row; the ack
    // handler flips it to sent/failed via deliveryId.
    await this.db.insert(outboxMessages).values({
      conversationId,
      deliveryId,
      chatGuid: conv.externalId,
      text: req.text,
    });
    await this.db.insert(messages).values({
      conversationId,
      direction: "outbound",
      channel: "imessage",
      text: req.text,
      sentAt: new Date(),
    });
    this.opts.notifyImsgOutbox?.();
    outcome.results.push({ channel: "imessage", status: "pending", recipient: conv.externalId });
  }

  // --- helpers ------------------------------------------------------------------

  /**
   * Member-targeted notifications go to that member. Conversation-targeted
   * ones go to the conversation's participants; a conversation without
   * participant rows (or a household-wide item) fans out to every member.
   */
  private async resolveRecipients(req: NotificationRequest): Promise<Recipient[]> {
    let memberIds: string[] = [];
    if (req.target.memberId) {
      memberIds = [req.target.memberId];
    } else if (req.target.conversationId) {
      const participants = await this.db
        .select({ memberId: conversationParticipants.memberId })
        .from(conversationParticipants)
        .where(eq(conversationParticipants.conversationId, req.target.conversationId));
      memberIds = participants.map((p) => p.memberId);
    }
    if (memberIds.length === 0) {
      const all = await this.db
        .select({ id: members.id })
        .from(members)
        .where(eq(members.householdId, req.householdId));
      memberIds = all.map((m) => m.id);
    }
    if (memberIds.length === 0) return [];

    const rows = await this.db
      .select({ id: members.id, displayName: members.displayName })
      .from(members)
      .where(inArray(members.id, memberIds));
    const phones = await this.db
      .select({ memberId: identities.memberId, value: identities.value })
      .from(identities)
      .where(and(inArray(identities.memberId, memberIds), eq(identities.type, "phone")));
    const phoneByMember = new Map(phones.map((p) => [p.memberId, p.value]));

    return rows.map((m) => ({
      memberId: m.id,
      displayName: m.displayName,
      phone: phoneByMember.get(m.id) ?? null,
    }));
  }

  /** Insert a delivery row; returns its id, or null when the dedupe key already exists. */
  private async insertDelivery(
    req: NotificationRequest,
    row: {
      channel: "sms" | "imessage";
      dedupeKey: string;
      memberId?: string | null;
      conversationId?: string | null;
      recipientAddress?: string | null;
      status: "pending" | "skipped" | "failed";
      error?: string | null;
    }
  ): Promise<string | null> {
    const [inserted] = await this.db
      .insert(deliveries)
      .values({
        kind: req.kind,
        reminderId: req.sourceId,
        taskId: req.taskId ?? null,
        conversationId: row.conversationId ?? null,
        memberId: row.memberId ?? null,
        channel: row.channel,
        dedupeKey: row.dedupeKey,
        recipientAddress: row.recipientAddress ?? null,
        status: row.status,
        error: row.error ?? null,
        scheduledFor: new Date(req.occurrenceKey),
      })
      .onConflictDoNothing({ target: deliveries.dedupeKey })
      .returning({ id: deliveries.id });
    return inserted?.id ?? null;
  }
}
