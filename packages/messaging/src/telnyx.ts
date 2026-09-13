import { and, eq } from "drizzle-orm";
import type { Db } from "@fambot/database";
import {
  conversationParticipants,
  conversations,
  identities,
  members,
  messages,
} from "@fambot/database";
import type { MessagingChannel } from "./index";

export type TelnyxConfig = {
  apiKey: string;
  /** E.164 sender number owned by the Telnyx messaging profile. */
  fromNumber: string;
  messagingProfileId?: string;
  /** Injectable for tests. */
  fetchFn?: typeof fetch;
};

const TELNYX_MESSAGES_URL = "https://api.telnyx.com/v2/messages";
const TELNYX_GROUP_MMS_URL = "https://api.telnyx.com/v2/messages/group_mms";
export const MAX_GROUP_MMS_RECIPIENTS = 8;
export const TELNYX_UNREACHABLE_MESSAGE =
  "Telnyx is unreachable. Check your network connection and that TELNYX_API_KEY is valid.";

/** Network / DNS / timeout failures talking to api.telnyx.com. */
export function isTelnyxUnreachable(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  const cause = error.cause instanceof Error ? `${error.cause.name} ${error.cause.message}` : "";
  return /fetch failed|Failed to fetch|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|UND_ERR_|socket|network|certificate|unreachable|aborted/i.test(
    `${error.name} ${error.message} ${cause}`
  );
}

export function wrapTelnyxNetworkError(error: unknown): Error {
  if (isTelnyxUnreachable(error)) return new Error(TELNYX_UNREACHABLE_MESSAGE);
  return error instanceof Error ? error : new Error(String(error));
}

async function telnyxFetch(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit
): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch (error) {
    throw wrapTelnyxNetworkError(error);
  }
}

/**
 * Telnyx SMS. `sendSms` is the raw provider call; a 2xx response means Telnyx
 * *queued* the message, not that it was delivered — delivery state arrives
 * later via `message.sent` / `message.finalized` webhooks. Telnyx has no
 * documented idempotency key for message sends, so callers must dedupe at the
 * database level (deliveries.dedupeKey) before invoking this.
 */
export class TelnyxSmsChannel implements MessagingChannel {
  constructor(
    private db: Db,
    private config: TelnyxConfig
  ) {}

  async sendSms(args: { to: string; text: string }): Promise<{ providerMessageId: string }> {
    const fetchFn = this.config.fetchFn ?? fetch;
    const res = await telnyxFetch(fetchFn, TELNYX_MESSAGES_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: this.config.fromNumber,
        to: args.to,
        text: args.text,
        type: "SMS",
        ...(this.config.messagingProfileId
          ? { messaging_profile_id: this.config.messagingProfileId }
          : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`telnyx send failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const body = (await res.json()) as { data?: { id?: string } };
    return { providerMessageId: body.data?.id ?? "" };
  }

  async sendGroupMms(args: {
    to: string[];
    text: string;
  }): Promise<{ providerMessageId: string; groupMessageId: string }> {
    const recipients = [...new Set(args.to)];
    if (recipients.length < 2) throw new Error("group MMS requires at least two recipients");
    if (recipients.length > MAX_GROUP_MMS_RECIPIENTS) {
      throw new Error(`group MMS supports at most ${MAX_GROUP_MMS_RECIPIENTS} recipients`);
    }
    if (recipients.some((phone) => !/^\+1\d{10}$/.test(phone))) {
      throw new Error("group MMS only supports US and Canadian +1 numbers");
    }
    const fetchFn = this.config.fetchFn ?? fetch;
    const res = await telnyxFetch(fetchFn, TELNYX_GROUP_MMS_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: this.config.fromNumber,
        to: recipients,
        text: args.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`telnyx group MMS send failed (${res.status}): ${body.slice(0, 300)}`);
    }
    const body = (await res.json()) as {
      data?: { id?: string; group_message_id?: string };
    };
    return {
      providerMessageId: body.data?.id ?? "",
      groupMessageId: body.data?.group_message_id ?? body.data?.id ?? "",
    };
  }

  /**
   * Conversation-reply path (two-way SMS). SMS conversations store the E.164
   * phone as `externalId`; the outbound text is mirrored into history.
   */
  async sendMessage({
    conversationId,
    text,
    kind = "message",
  }: {
    conversationId: string;
    text: string;
    kind?: "message" | "progress";
  }): Promise<void> {
    const [conv] = await this.db
      .select({ externalId: conversations.externalId, kind: conversations.kind })
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!conv?.externalId) throw new Error(`conversation ${conversationId} has no phone number`);
    let providerMessageId: string;
    if (conv.kind === "group") {
      const participantRows = await this.db
        .select({ phone: identities.value })
        .from(conversationParticipants)
        .innerJoin(members, eq(conversationParticipants.memberId, members.id))
        .innerJoin(
          identities,
          and(eq(identities.memberId, members.id), eq(identities.type, "phone"))
        )
        .where(eq(conversationParticipants.conversationId, conversationId));
      ({ providerMessageId } = await this.sendGroupMms({
        to: participantRows.map((row) => row.phone),
        text,
      }));
    } else {
      ({ providerMessageId } = await this.sendSms({ to: conv.externalId, text }));
    }
    await this.db
      .insert(messages)
      .values({
        conversationId,
        direction: "outbound",
        channel: "sms",
        kind,
        externalMessageId: providerMessageId || null,
        text,
        sentAt: new Date(),
      })
      .onConflictDoNothing();
  }
}

/**
 * Canonical native group-MMS conversation for a household. The participant
 * set is synchronized every time so adding an invitee starts a new handset
 * group on the next reply.
 */
export async function getOrCreateSmsGroupConversation(
  db: Db,
  householdId: string
): Promise<string | null> {
  const recipients = await db
    .select({ memberId: members.id, phone: identities.value })
    .from(members)
    .innerJoin(
      identities,
      and(eq(identities.memberId, members.id), eq(identities.type, "phone"))
    )
    .where(eq(members.householdId, householdId));
  if (recipients.length < 2) return null;
  if (recipients.length > MAX_GROUP_MMS_RECIPIENTS) {
    throw new Error(`group MMS supports at most ${MAX_GROUP_MMS_RECIPIENTS} recipients`);
  }
  if (recipients.some(({ phone }) => !/^\+1\d{10}$/.test(phone))) {
    throw new Error("group MMS only supports US and Canadian +1 numbers");
  }

  const externalId = `sms-group:${householdId}`;
  const [created] = await db
    .insert(conversations)
    .values({
      householdId,
      channel: "sms",
      externalId,
      kind: "group",
      name: "Household group MMS",
    })
    .onConflictDoNothing({ target: [conversations.channel, conversations.externalId] })
    .returning({ id: conversations.id });
  const conversationId =
    created?.id ??
    (
      await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.channel, "sms"), eq(conversations.externalId, externalId)))
    )[0]!.id;

  await db
    .delete(conversationParticipants)
    .where(eq(conversationParticipants.conversationId, conversationId));
  await db.insert(conversationParticipants).values(
    recipients.map(({ memberId }) => ({ conversationId, memberId }))
  ).onConflictDoNothing();
  return conversationId;
}

/**
 * Stable per-member SMS thread: one direct conversation per phone number.
 * Used both when dispatching outbound notifications and when routing inbound
 * texts, so a task nudge and the member's "done" reply share a conversation.
 */
export async function getOrCreateSmsConversation(
  db: Db,
  args: { householdId: string; memberId: string; phone: string; displayName?: string | null }
): Promise<string> {
  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.channel, "sms"), eq(conversations.externalId, args.phone)));
  if (existing) return existing.id;

  const [created] = await db
    .insert(conversations)
    .values({
      householdId: args.householdId,
      channel: "sms",
      externalId: args.phone,
      kind: "direct",
      name: args.displayName ? `SMS · ${args.displayName}` : `SMS · ${args.phone}`,
    })
    .onConflictDoNothing({ target: [conversations.channel, conversations.externalId] })
    .returning({ id: conversations.id });
  const conversationId =
    created?.id ??
    (
      await db
        .select({ id: conversations.id })
        .from(conversations)
        .where(and(eq(conversations.channel, "sms"), eq(conversations.externalId, args.phone)))
    )[0]!.id;

  await db
    .insert(conversationParticipants)
    .values({ conversationId, memberId: args.memberId })
    .onConflictDoNothing();
  return conversationId;
}
