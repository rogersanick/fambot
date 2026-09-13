import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@fambot/database";
import { deliveries, householdInvites, telnyxEvents } from "@fambot/database";
import type { InboundMessage } from "@fambot/shared";

/**
 * Telnyx webhook handling: Ed25519 signature verification, a durable deduped
 * event queue (ack within Telnyx's two-second window, process afterwards),
 * inbound SMS routed into the shared pipeline, and idempotent out-of-order
 * delivery-status updates.
 */

// --- signature verification ---------------------------------------------------

/** DER SPKI prefix for a raw 32-byte Ed25519 public key. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const TIMESTAMP_TOLERANCE_SEC = 5 * 60;

/**
 * Telnyx signs `${timestamp}|${rawBody}` with Ed25519; the portal exposes the
 * public key base64-encoded. Stale timestamps are rejected to stop replays.
 */
export function verifyTelnyxSignature(args: {
  publicKeyBase64: string;
  signatureBase64: string | undefined;
  timestamp: string | undefined;
  rawBody: string;
  nowMs?: number;
}): boolean {
  if (!args.signatureBase64 || !args.timestamp) return false;
  const ts = Number(args.timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSec = (args.nowMs ?? Date.now()) / 1000;
  if (Math.abs(nowSec - ts) > TIMESTAMP_TOLERANCE_SEC) return false;

  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(args.publicKeyBase64, "base64")]),
      format: "der",
      type: "spki",
    });
    return cryptoVerify(
      null,
      Buffer.from(`${args.timestamp}|${args.rawBody}`),
      key,
      Buffer.from(args.signatureBase64, "base64")
    );
  } catch {
    return false;
  }
}

// --- durable event queue --------------------------------------------------------

type TelnyxWebhookPayload = {
  data?: {
    id?: string;
    event_type?: string;
    payload?: {
      id?: string;
      direction?: string;
      text?: string;
      received_at?: string;
      group_message_id?: string;
      from?: { phone_number?: string };
      to?: Array<{ phone_number?: string; status?: string }>;
      cc?: Array<string | { phone_number?: string }>;
      errors?: Array<{ code?: string; title?: string; detail?: string }>;
    };
  };
};

/** Insert the event (deduped on Telnyx event id). Returns true if it is new. */
export async function enqueueTelnyxEvent(db: Db, payload: TelnyxWebhookPayload): Promise<boolean> {
  const eventId = payload.data?.id;
  const eventType = payload.data?.event_type;
  if (!eventId || !eventType) return false;
  const inserted = await db
    .insert(telnyxEvents)
    .values({ eventId, eventType, payload })
    .onConflictDoNothing({ target: telnyxEvents.eventId })
    .returning({ id: telnyxEvents.id });
  return inserted.length > 0;
}

const MAX_EVENT_ATTEMPTS = 5;

export type TelnyxProcessorDeps = {
  /** The shared message pipeline (injected so tests can fake it). */
  processInbound: (inbound: InboundMessage) => Promise<unknown>;
};

/** Drain pending queue rows oldest-first. Returns how many were processed. */
export async function drainTelnyxEvents(db: Db, deps: TelnyxProcessorDeps): Promise<number> {
  const rows = await db
    .select()
    .from(telnyxEvents)
    .where(and(eq(telnyxEvents.status, "pending"), lt(telnyxEvents.attemptCount, MAX_EVENT_ATTEMPTS)))
    .orderBy(asc(telnyxEvents.createdAt))
    .limit(25);

  let processed = 0;
  for (const row of rows) {
    try {
      await processTelnyxEvent(db, row.payload as TelnyxWebhookPayload, deps);
      await db
        .update(telnyxEvents)
        .set({ status: "processed", processedAt: new Date(), error: null })
        .where(eq(telnyxEvents.id, row.id));
      processed++;
    } catch (err) {
      const attempts = row.attemptCount + 1;
      await db
        .update(telnyxEvents)
        .set({
          attemptCount: attempts,
          status: attempts >= MAX_EVENT_ATTEMPTS ? "failed" : "pending",
          error: err instanceof Error ? err.message : String(err),
        })
        .where(eq(telnyxEvents.id, row.id));
      console.error(`[telnyx] event ${row.eventId} failed (attempt ${attempts}):`, err);
    }
  }
  return processed;
}

/** Handle one webhook event. Idempotent and safe out of order. */
export async function processTelnyxEvent(
  db: Db,
  payload: TelnyxWebhookPayload,
  deps: TelnyxProcessorDeps
): Promise<void> {
  const eventType = payload.data?.event_type;
  const msg = payload.data?.payload;
  if (!eventType || !msg) return;

  if (eventType === "message.received" && msg.direction === "inbound") {
    const from = msg.from?.phone_number;
    const text = msg.text?.trim();
    if (!from || !text) return;
    const destinations = new Set(
      (msg.to ?? []).map((entry) => entry.phone_number).filter(Boolean)
    );
    const cc = (msg.cc ?? [])
      .map((entry) => (typeof entry === "string" ? entry : entry.phone_number))
      .filter((phone): phone is string => Boolean(phone) && !destinations.has(phone));
    const isGroup = cc.length > 0;
    const inbound: InboundMessage = {
      id: `sms:${msg.id ?? crypto.randomUUID()}`,
      channel: "sms",
      externalMessageId: msg.id,
      conversationExternalId: msg.group_message_id ?? from,
      sender: { externalId: from },
      participantExternalIds: isGroup ? [from, ...cc] : undefined,
      text,
      sentAt: msg.received_at ?? new Date().toISOString(),
      context: { isGroup, botWasMentioned: !isGroup, isReplyToBot: false },
    };
    await deps.processInbound(inbound);
    return;
  }

  if (eventType === "message.sent" || eventType === "message.finalized") {
    const providerMessageId = msg.id;
    if (!providerMessageId) return;
    const toStatus = msg.to?.[0]?.status ?? "";

    if (eventType === "message.finalized" && toStatus === "delivered") {
      await db
        .update(deliveries)
        .set({ status: "delivered", deliveredAt: new Date(), error: null })
        .where(eq(deliveries.providerMessageId, providerMessageId));
      await db
        .update(householdInvites)
        .set({ smsStatus: "delivered", sendError: null, updatedAt: new Date() })
        .where(eq(householdInvites.providerMessageId, providerMessageId));
    } else if (
      eventType === "message.finalized" &&
      (toStatus === "delivery_failed" || toStatus === "sending_failed" || toStatus === "expired")
    ) {
      const detail = (msg.errors ?? [])
        .map((error) => error.detail ?? error.title ?? error.code)
        .filter(Boolean)
        .join("; ");
      console.warn(
        `[telnyx] outbound ${toStatus} for ${providerMessageId}${detail ? `: ${detail}` : ""}`
      );
      await db
        .update(deliveries)
        .set({ status: "failed", error: `telnyx: ${toStatus}` })
        .where(
          and(
            eq(deliveries.providerMessageId, providerMessageId),
            // never downgrade a confirmed delivery
            sql`${deliveries.status} <> 'delivered'`
          )
        );
      await db
        .update(householdInvites)
        .set({ smsStatus: "failed", sendError: `telnyx: ${toStatus}`, updatedAt: new Date() })
        .where(eq(householdInvites.providerMessageId, providerMessageId));
    } else {
      // message.sent (or a finalized state we treat as sent): upgrade only —
      // out-of-order events must not regress delivered/failed rows.
      await db
        .update(deliveries)
        .set({ status: "sent" })
        .where(
          and(
            eq(deliveries.providerMessageId, providerMessageId),
            inArray(deliveries.status, ["pending", "queued"])
          )
        );
      await db
        .update(householdInvites)
        .set({ smsStatus: "sent", updatedAt: new Date() })
        .where(
          and(
            eq(householdInvites.providerMessageId, providerMessageId),
            inArray(householdInvites.smsStatus, ["pending", "queued"])
          )
        );
    }
  }
}

// --- local-dev inbound diagnostics --------------------------------------------

export const TELNYX_UNVERIFIED_NUMBER_RE =
  /verified phone numbers are allowed at this account level/i;

export function describeTelnyxInboundGap(args: {
  /** Newest-first inbound records. Older trial blocks are ignored if a later text succeeded. */
  inbound: Array<{ id: string; from: string; text: string | null }>;
  outbound?: Array<{ errors?: Array<{ code?: string; title?: string; detail?: string }> }>;
}): string[] {
  const latestByFrom = new Map<string, (typeof args.inbound)[number]>();
  for (const message of args.inbound) {
    if (!latestByFrom.has(message.from)) latestByFrom.set(message.from, message);
  }
  const warnings: string[] = [];
  for (const message of latestByFrom.values()) {
    if (TELNYX_UNVERIFIED_NUMBER_RE.test(message.text ?? "")) {
      warnings.push(
        `Telnyx received SMS from ${message.from} but blocked it — verify that phone on this Telnyx account, then text again.`
      );
    }
  }
  const tenDlc = (args.outbound ?? []).some((message) =>
    (message.errors ?? []).some(
      (error) => error.code === "40010" || /10DLC/i.test(`${error.title ?? ""} ${error.detail ?? ""}`)
    )
  );
  if (tenDlc) {
    warnings.push(
      "Telnyx delivered the inbound text, but the reply failed: this long code is not 10DLC-registered. Register a brand and campaign in Mission Control → 10DLC, assign the Fambot number to it, then text again."
    );
  }
  return warnings;
}

/** Looks at recent SMS when webhooks are silent or outbound replies fail (10DLC / trial). */
export async function checkTelnyxInboundHealth(args: {
  apiKey: string;
  fetchFn?: typeof fetch;
}): Promise<string[]> {
  const fetchFn = args.fetchFn ?? fetch;
  const headers = { authorization: `Bearer ${args.apiKey}` };
  const recordsRes = await fetchFn(
    "https://api.telnyx.com/v2/detail_records?filter[record_type]=messaging&page[size]=8",
    { headers }
  );
  const recordsJson = (await recordsRes.json()) as {
    data?: Array<{ id?: string; direction?: string; cli?: string; cld?: string }>;
  };
  const rows = (recordsJson.data ?? []).filter((row) => row.id);
  const messages = await Promise.all(
    rows.map(async (row) => {
      const res = await fetchFn(`https://api.telnyx.com/v2/messages/${row.id}`, { headers });
      const json = (await res.json()) as {
        data?: {
          id?: string;
          direction?: string;
          text?: string;
          from?: { phone_number?: string };
          errors?: Array<{ code?: string; title?: string; detail?: string }>;
        };
      };
      return {
        id: json.data?.id ?? row.id!,
        direction: json.data?.direction ?? row.direction,
        from: json.data?.from?.phone_number ?? row.cli ?? "unknown",
        text: json.data?.text ?? null,
        errors: json.data?.errors,
      };
    })
  );
  return describeTelnyxInboundGap({
    inbound: messages.filter((message) => message.direction === "inbound"),
    outbound: messages.filter((message) => message.direction === "outbound"),
  });
}
