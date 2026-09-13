import { beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, randomUUID, sign as cryptoSign } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb, deliveries, telnyxEvents, type Db } from "@fambot/database";
import type { InboundMessage } from "@fambot/shared";
import {
  checkTelnyxInboundHealth,
  describeTelnyxInboundGap,
  drainTelnyxEvents,
  enqueueTelnyxEvent,
  processTelnyxEvent,
  verifyTelnyxSignature,
} from "./telnyx";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:fambot@localhost:5433/fambot";

let db: Db;
let available = false;

beforeAll(async () => {
  db = createDb(DATABASE_URL);
  try {
    await db.execute("select 1" as never);
    available = true;
  } catch {
    console.warn("[telnyx.test] local Postgres unavailable — skipping integration tests");
  }
});

// --- signature verification (pure) ---------------------------------------------

function makeKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  // Telnyx publishes the raw 32-byte key base64-encoded (strip the SPKI header).
  const publicKeyBase64 = spki.subarray(spki.length - 32).toString("base64");
  return { privateKey, publicKeyBase64 };
}

function signPayload(privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"], timestamp: string, body: string) {
  return cryptoSign(null, Buffer.from(`${timestamp}|${body}`), privateKey).toString("base64");
}

describe("verifyTelnyxSignature", () => {
  const { privateKey, publicKeyBase64 } = makeKeys();
  const body = JSON.stringify({ data: { id: "evt_1", event_type: "message.received" } });
  const ts = String(Math.floor(Date.now() / 1000));

  test("accepts a valid signature", () => {
    expect(
      verifyTelnyxSignature({
        publicKeyBase64,
        signatureBase64: signPayload(privateKey, ts, body),
        timestamp: ts,
        rawBody: body,
      })
    ).toBe(true);
  });

  test("rejects a tampered body", () => {
    expect(
      verifyTelnyxSignature({
        publicKeyBase64,
        signatureBase64: signPayload(privateKey, ts, body),
        timestamp: ts,
        rawBody: body + " ",
      })
    ).toBe(false);
  });

  test("rejects a signature from a different key", () => {
    const other = makeKeys();
    expect(
      verifyTelnyxSignature({
        publicKeyBase64,
        signatureBase64: signPayload(other.privateKey, ts, body),
        timestamp: ts,
        rawBody: body,
      })
    ).toBe(false);
  });

  test("rejects stale timestamps (replay protection)", () => {
    const stale = String(Math.floor(Date.now() / 1000) - 10 * 60);
    expect(
      verifyTelnyxSignature({
        publicKeyBase64,
        signatureBase64: signPayload(privateKey, stale, body),
        timestamp: stale,
        rawBody: body,
      })
    ).toBe(false);
  });

  test("rejects missing headers", () => {
    expect(
      verifyTelnyxSignature({
        publicKeyBase64,
        signatureBase64: undefined,
        timestamp: ts,
        rawBody: body,
      })
    ).toBe(false);
  });
});

describe("group MMS webhook normalization", () => {
  test("preserves sender, participants, and group context", async () => {
    const received: InboundMessage[] = [];
    await processTelnyxEvent(
      null as never,
      {
        data: {
          id: "evt-group",
          event_type: "message.received",
          payload: {
            id: "msg-group",
            group_message_id: "group-123",
            direction: "inbound",
            text: "@fambot add milk",
            from: { phone_number: "+15551230001" },
            to: [{ phone_number: "+15550000000" }],
            // Telnyx includes its own destination in cc; normalization removes it.
            cc: ["+15551230002", "+15550000000"],
          },
        },
      },
      { processInbound: async (message) => received.push(message) }
    );
    expect(received).toHaveLength(1);
    expect(received[0]!.conversationExternalId).toBe("group-123");
    expect(received[0]!.participantExternalIds).toEqual([
      "+15551230001",
      "+15551230002",
    ]);
    expect(received[0]!.context.isGroup).toBe(true);
  });
});

// --- durable queue + processing (integration) ------------------------------------

function inboundEvent(eventId: string, msgId: string, from: string, text: string) {
  return {
    data: {
      id: eventId,
      event_type: "message.received",
      payload: {
        id: msgId,
        direction: "inbound",
        text,
        received_at: new Date().toISOString(),
        from: { phone_number: from },
        to: [{ phone_number: "+15550000000" }],
      },
    },
  };
}

function statusEvent(eventId: string, type: "message.sent" | "message.finalized", msgId: string, toStatus: string) {
  return {
    data: {
      id: eventId,
      event_type: type,
      payload: {
        id: msgId,
        direction: "outbound",
        to: [{ phone_number: "+15551234567", status: toStatus }],
      },
    },
  };
}

async function makeDelivery(providerMessageId: string, status: "queued" | "sent" | "delivered" = "queued") {
  const [row] = await db
    .insert(deliveries)
    .values({
      kind: "reminder",
      channel: "sms",
      dedupeKey: `test:${randomUUID()}`,
      status,
      providerMessageId,
      scheduledFor: new Date(),
    })
    .returning();
  return row!;
}

describe("telnyx webhook queue (integration)", () => {
  test("enqueue dedupes on Telnyx event id", async () => {
    if (!available) return;
    const evt = inboundEvent(`evt-${randomUUID()}`, `msg-${randomUUID()}`, "+15551230000", "hi");
    expect(await enqueueTelnyxEvent(db, evt)).toBe(true);
    expect(await enqueueTelnyxEvent(db, evt)).toBe(false); // redelivered webhook
  });

  test("drain routes inbound SMS into the pipeline as a normalized sms InboundMessage", async () => {
    if (!available) return;
    const received: InboundMessage[] = [];
    const from = "+15559876543";
    const msgId = `msg-${randomUUID()}`;
    const evt = inboundEvent(`evt-${randomUUID()}`, msgId, from, "done");
    await enqueueTelnyxEvent(db, evt);
    const processed = await drainTelnyxEvents(db, {
      processInbound: async (m) => {
        received.push(m);
      },
    });
    expect(processed).toBeGreaterThanOrEqual(1);
    const mine = received.find((m) => m.externalMessageId === msgId)!;
    expect(mine).toBeDefined();
    expect(mine.channel).toBe("sms");
    expect(mine.conversationExternalId).toBe(from);
    expect(mine.sender.externalId).toBe(from);
    expect(mine.text).toBe("done");
    expect(mine.context.isGroup).toBe(false);

    // A processed event is never reprocessed.
    const again = await drainTelnyxEvents(db, {
      processInbound: async (m) => {
        received.push(m);
      },
    });
    expect(received.filter((m) => m.externalMessageId === msgId)).toHaveLength(1);
    void again;
  });

  test("a failing event is retried then marked failed, without blocking the queue", async () => {
    if (!available) return;
    const evt = inboundEvent(`evt-${randomUUID()}`, `msg-${randomUUID()}`, "+15550001112", "boom");
    await enqueueTelnyxEvent(db, evt);
    const deps = {
      processInbound: async (m: InboundMessage) => {
        if (m.text === "boom") throw new Error("pipeline exploded");
      },
    };
    for (let i = 0; i < 6; i++) await drainTelnyxEvents(db, deps);
    const [row] = await db.select().from(telnyxEvents).where(eq(telnyxEvents.eventId, evt.data.id));
    expect(row!.status).toBe("failed");
    expect(row!.attemptCount).toBe(5);
    expect(row!.error).toContain("pipeline exploded");
  });
});

describe("telnyx delivery status transitions (integration)", () => {
  const noopDeps = { processInbound: async () => {} };

  test("message.sent upgrades queued → sent", async () => {
    if (!available) return;
    const msgId = `msg-${randomUUID()}`;
    const d = await makeDelivery(msgId, "queued");
    await processTelnyxEvent(db, statusEvent(`e-${randomUUID()}`, "message.sent", msgId, "sent"), noopDeps);
    const [after] = await db.select().from(deliveries).where(eq(deliveries.id, d.id));
    expect(after!.status).toBe("sent");
  });

  test("message.finalized delivered marks delivered; a late message.sent cannot regress it", async () => {
    if (!available) return;
    const msgId = `msg-${randomUUID()}`;
    const d = await makeDelivery(msgId, "queued");
    // Out of order: finalized arrives before sent.
    await processTelnyxEvent(db, statusEvent(`e-${randomUUID()}`, "message.finalized", msgId, "delivered"), noopDeps);
    await processTelnyxEvent(db, statusEvent(`e-${randomUUID()}`, "message.sent", msgId, "sent"), noopDeps);
    const [after] = await db.select().from(deliveries).where(eq(deliveries.id, d.id));
    expect(after!.status).toBe("delivered");
    expect(after!.deliveredAt).not.toBeNull();
  });

  test("message.finalized delivery_failed marks failed, but never downgrades delivered", async () => {
    if (!available) return;
    const msgId = `msg-${randomUUID()}`;
    const d = await makeDelivery(msgId, "sent");
    await processTelnyxEvent(
      db,
      statusEvent(`e-${randomUUID()}`, "message.finalized", msgId, "delivery_failed"),
      noopDeps
    );
    const [after] = await db.select().from(deliveries).where(eq(deliveries.id, d.id));
    expect(after!.status).toBe("failed");
    expect(after!.error).toContain("delivery_failed");

    const msgId2 = `msg-${randomUUID()}`;
    const d2 = await makeDelivery(msgId2, "delivered");
    await processTelnyxEvent(
      db,
      statusEvent(`e-${randomUUID()}`, "message.finalized", msgId2, "delivery_failed"),
      noopDeps
    );
    const [after2] = await db.select().from(deliveries).where(eq(deliveries.id, d2.id));
    expect(after2!.status).toBe("delivered");
  });

  test("duplicate status events are idempotent", async () => {
    if (!available) return;
    const msgId = `msg-${randomUUID()}`;
    const d = await makeDelivery(msgId, "queued");
    const evt = statusEvent(`e-${randomUUID()}`, "message.finalized", msgId, "delivered");
    await processTelnyxEvent(db, evt, noopDeps);
    await processTelnyxEvent(db, evt, noopDeps);
    const [after] = await db.select().from(deliveries).where(eq(deliveries.id, d.id));
    expect(after!.status).toBe("delivered");
  });
});

describe("Telnyx inbound health", () => {
  test("warns when the latest inbound from a number was blocked", () => {
    const warnings = describeTelnyxInboundGap({
      inbound: [
        {
          id: "m1",
          from: "+15551234567",
          text: "Only messages from verified phone numbers are allowed at this account level. Refer to https://telnyx.com/upgrade",
        },
      ],
    });
    expect(warnings.some((line) => /blocked/.test(line) && line.includes("+15551234567"))).toBe(true);
  });

  test("ignores older trial blocks after a later inbound succeeds", () => {
    const warnings = describeTelnyxInboundGap({
      inbound: [
        { id: "m2", from: "+15551234567", text: "Test" },
        {
          id: "m1",
          from: "+15551234567",
          text: "Only messages from verified phone numbers are allowed at this account level. Refer to https://telnyx.com/upgrade",
        },
      ],
    });
    expect(warnings).toEqual([]);
  });

  test("warns when an outbound reply failed for missing 10DLC", () => {
    const warnings = describeTelnyxInboundGap({
      inbound: [{ id: "m2", from: "+15551234567", text: "Test" }],
      outbound: [
        {
          errors: [
            {
              code: "40010",
              title: "Not 10DLC registered",
              detail: "The sending number is not 10DLC-registered but is required to be by the carrier.",
            },
          ],
        },
      ],
    });
    expect(warnings.join("\n")).toMatch(/10DLC/);
  });

  test("checkTelnyxInboundHealth reads verified numbers and recent inbound text", async () => {
    const fetchFn = (async (url: unknown) => {
      const href = String(url);
      if (href.includes("/detail_records")) {
        return new Response(
          JSON.stringify({ data: [{ id: "m1", direction: "inbound", cli: "+15551234567" }] }),
          { status: 200 }
        );
      }
      if (href.includes("/messages/m1")) {
        return new Response(
          JSON.stringify({
            data: {
              id: "m1",
              text: "Only messages from verified phone numbers are allowed at this account level. Refer to https://telnyx.com/upgrade",
              from: { phone_number: "+15551234567" },
            },
          }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    const warnings = await checkTelnyxInboundHealth({ apiKey: "k", fetchFn });
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.join("\n")).toMatch(/verify that phone/i);
  });
});
