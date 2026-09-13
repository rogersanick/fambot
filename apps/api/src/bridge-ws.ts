import { and, eq, lt, lte } from "drizzle-orm";
import { deliveries, outboxMessages } from "@fambot/database";
import { db, setOutboxNotifier } from "./context";

/**
 * Outbound iMessage delivery to the Mac bridge.
 *
 * The bridge opens a WebSocket; the API pushes pending outbox rows as
 * {type:"send", id, chatGuid, text} and the bridge acks with
 * {type:"ack", id, ok, externalMessageId?, error?}. Rows stuck in "sending"
 * (bridge died mid-send) are reset to pending after a timeout.
 */

type BridgeSocket = {
  send(data: string): void;
};

let socket: BridgeSocket | null = null;
let lastSeen: Date | null = null;
let flushing = false;

export function getBridgeStatus() {
  return {
    connected: socket !== null,
    lastSeen: lastSeen?.toISOString() ?? null,
  };
}

export function bridgeConnected(ws: BridgeSocket) {
  socket = ws;
  lastSeen = new Date();
  void flushOutbox();
}

export function bridgeDisconnected(ws: BridgeSocket) {
  if (socket === ws) socket = null;
}

export async function bridgeMessage(raw: string | Buffer) {
  lastSeen = new Date();
  let msg: { type?: string; id?: string; ok?: boolean; externalMessageId?: string; error?: string };
  try {
    msg = JSON.parse(String(raw));
  } catch {
    return;
  }
  if (msg.type === "ping") return;
  if (msg.type === "ack" && msg.id) {
    const [row] = await db.select().from(outboxMessages).where(eq(outboxMessages.id, msg.id));
    if (msg.ok) {
      await db
        .update(outboxMessages)
        .set({ status: "sent", externalMessageId: msg.externalMessageId ?? null, sentAt: new Date() })
        .where(eq(outboxMessages.id, msg.id));
      // Scheduled-notification deliveries are only "sent" once the bridge
      // actually delivered the outbox row to Messages.app.
      if (row?.deliveryId) {
        await db
          .update(deliveries)
          .set({ status: "sent", deliveredAt: new Date(), error: null })
          .where(eq(deliveries.id, row.deliveryId));
      }
    } else {
      const attempts = row?.attemptCount ?? 0;
      const exhausted = attempts >= 5;
      await db
        .update(outboxMessages)
        .set({
          status: exhausted ? "failed" : "pending",
          error: msg.error ?? "send failed",
        })
        .where(eq(outboxMessages.id, msg.id));
      if (exhausted && row?.deliveryId) {
        await db
          .update(deliveries)
          .set({ status: "failed", error: msg.error ?? "bridge send failed" })
          .where(eq(deliveries.id, row.deliveryId));
      }
    }
  }
}

export async function flushOutbox() {
  if (!socket || flushing) return;
  flushing = true;
  try {
    const rows = await db
      .select()
      .from(outboxMessages)
      .where(eq(outboxMessages.status, "pending"))
      .orderBy(outboxMessages.createdAt)
      .limit(20);
    for (const row of rows) {
      await db
        .update(outboxMessages)
        .set({ status: "sending", attemptCount: row.attemptCount + 1 })
        .where(eq(outboxMessages.id, row.id));
      socket.send(JSON.stringify({ type: "send", id: row.id, chatGuid: row.chatGuid, text: row.text }));
    }
  } finally {
    flushing = false;
  }
}

/** Reset rows stuck in "sending" (no ack) back to pending for retry. */
async function resetStale() {
  await db
    .update(outboxMessages)
    .set({ status: "pending" })
    .where(
      and(
        eq(outboxMessages.status, "sending"),
        lt(outboxMessages.createdAt, new Date(Date.now() - 60_000)),
        lte(outboxMessages.attemptCount, 5)
      )
    );
}

setOutboxNotifier(() => void flushOutbox());
setInterval(() => {
  void resetStale().then(() => flushOutbox());
}, 15_000);
