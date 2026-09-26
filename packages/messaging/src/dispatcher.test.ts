import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  createDb,
  conversations,
  deliveries,
  householdNotificationChannels,
  households,
  identities,
  members,
  messages,
  outboxMessages,
  pushDevices,
  reminders,
  tasks,
  type Db,
} from "@fambot/database";
import { NotificationDispatcher } from "./dispatcher";
import { TelnyxSmsChannel } from "./telnyx";
import { ApnsClient, type ApnsTransport } from "./apns";

/** Integration tests against the local dev Postgres; skipped when unavailable. */
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:fambot@localhost:5433/fambot";

let db: Db;
let available = false;

beforeAll(async () => {
  db = createDb(DATABASE_URL);
  try {
    await db.execute("select 1" as never);
    available = true;
  } catch {
    console.warn("[dispatcher.test] local Postgres unavailable — skipping integration tests");
  }
});

function fakeTelnyx() {
  const smsSent: Array<{ to: string; text: string }> = [];
  const telnyx = new TelnyxSmsChannel(db, {
    apiKey: "test",
    fromNumber: "+15550000000",
    fetchFn: (async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body ?? "{}"));
      smsSent.push({ to: body.to, text: body.text });
      return new Response(JSON.stringify({ data: { id: `tmsg_${randomUUID()}` } }), { status: 200 });
    }) as unknown as typeof fetch,
  });
  return { telnyx, smsSent };
}

function randPhone() {
  return `+1444${String(Math.floor(Math.random() * 10_000_000)).padStart(7, "0")}`;
}

/** Test P-256 key generated once; the fake transport never verifies it. */
let testApnsKeyPem: Promise<string> | null = null;
function apnsKeyPem(): Promise<string> {
  testApnsKeyPem ??= (async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
    return `-----BEGIN PRIVATE KEY-----\n${pkcs8.toString("base64")}\n-----END PRIVATE KEY-----`;
  })();
  return testApnsKeyPem;
}

async function fakeApns(
  respond: (req: { host: string; path: string }) => { status: number; body?: string } = () => ({
    status: 200,
  })
) {
  const pushSent: Array<{ host: string; token: string; body: string }> = [];
  const transport: ApnsTransport = async (args) => {
    pushSent.push({ host: args.host, token: args.path.replace("/3/device/", ""), body: args.body });
    const res = respond(args);
    return {
      status: res.status,
      headers: { "apns-id": `apns_${randomUUID()}` },
      body: res.body ?? "",
    };
  };
  const apns = new ApnsClient({
    teamId: "TEAM123456",
    keyId: "KEY1234567",
    bundleId: "app.fambot.desktop",
    privateKey: await apnsKeyPem(),
    transport,
  });
  return { apns, pushSent };
}

async function registerDevice(
  memberId: string,
  opts?: { environment?: "sandbox" | "production"; token?: string }
) {
  const [device] = await db
    .insert(pushDevices)
    .values({
      memberId,
      installationId: randomUUID(),
      platform: "ios",
      token: opts?.token ?? randomUUID().replaceAll("-", ""),
      environment: opts?.environment ?? "sandbox",
      active: true,
    })
    .returning();
  return device!;
}

async function fixture(opts?: {
  sms?: boolean;
  imessage?: boolean;
  push?: boolean;
  memberCount?: number;
}) {
  const [household] = await db
    .insert(households)
    .values({ name: `disp-${randomUUID().slice(0, 8)}`, timezone: "America/New_York" })
    .returning();
  const rows: Array<{ id: string; phone: string }> = [];
  for (let i = 0; i < (opts?.memberCount ?? 1); i++) {
    const [m] = await db
      .insert(members)
      .values({ householdId: household!.id, displayName: `M${i}`, role: i === 0 ? "owner" : "member" })
      .returning();
    const phone = randPhone();
    await db.insert(identities).values({ memberId: m!.id, type: "phone", value: phone });
    rows.push({ id: m!.id, phone });
  }
  // Household iMessage group conversation (chat_guid set) for the imessage channel.
  const [imsgConv] = await db
    .insert(conversations)
    .values({
      householdId: household!.id,
      channel: "imessage",
      externalId: `iMessage;+;chat-${randomUUID().slice(0, 8)}`,
      kind: "group",
      name: "Family",
    })
    .returning();
  await db.insert(householdNotificationChannels).values([
    { householdId: household!.id, channel: "sms", enabled: opts?.sms ?? true },
    {
      householdId: household!.id,
      channel: "imessage",
      enabled: opts?.imessage ?? false,
      conversationId: opts?.imessage ? imsgConv!.id : null,
    },
    { householdId: household!.id, channel: "push", enabled: opts?.push ?? false },
  ]);
  return { household: household!, members: rows, imsgConv: imsgConv! };
}

/** deliveries.reminderId is a real FK, so dispatch tests need actual reminder rows. */
async function makeReminder(householdId: string, memberId: string | null) {
  const [task] = await db
    .insert(tasks)
    .values({
      householdId,
      title: "parent task",
      status: "open",
    })
    .returning();
  const [row] = await db
    .insert(reminders)
    .values({
      householdId,
      title: "test reminder",
      taskId: task!.id,
      targetType: memberId ? "member" : "conversation",
      targetMemberId: memberId,
      timezone: "America/New_York",
      status: "scheduled",
    })
    .returning();
  return row!.id;
}

describe("NotificationDispatcher (integration)", () => {
  test("broadcasts to every enabled channel: SMS per member plus one iMessage outbox row", async () => {
    if (!available) return;
    const f = await fixture({ sms: true, imessage: true, memberCount: 2 });
    const { telnyx, smsSent } = fakeTelnyx();
    const dispatcher = new NotificationDispatcher(db, { telnyx });

    const reminderId = await makeReminder(f.household.id, null);
    await dispatcher.dispatch({
      householdId: f.household.id,
      kind: "reminder",
      sourceId: reminderId,
      occurrenceKey: new Date().toISOString(),
      target: { memberId: null, conversationId: null }, // household-wide fan-out
      text: "⏰ Reminder: family dinner",
    });

    // One SMS per member with a phone.
    expect(smsSent.map((s) => s.to).sort()).toEqual(f.members.map((m) => m.phone).sort());

    const audit = await db.select().from(deliveries).where(eq(deliveries.reminderId, reminderId));
    const sms = audit.filter((d) => d.channel === "sms");
    const imsg = audit.filter((d) => d.channel === "imessage");
    expect(sms).toHaveLength(2);
    expect(sms.every((d) => d.status === "queued" && d.providerMessageId)).toBe(true);
    expect(imsg).toHaveLength(1);
    // iMessage stays pending until the bridge acks the linked outbox row.
    expect(imsg[0]!.status).toBe("pending");
    const [outbox] = await db
      .select()
      .from(outboxMessages)
      .where(eq(outboxMessages.deliveryId, imsg[0]!.id));
    expect(outbox).toBeDefined();
    expect(outbox!.chatGuid).toBe(f.imsgConv.externalId!);
  });

  test("re-dispatching the same occurrence is a no-op (database dedupe is authoritative)", async () => {
    if (!available) return;
    const f = await fixture();
    const { telnyx, smsSent } = fakeTelnyx();
    const dispatcher = new NotificationDispatcher(db, { telnyx });

    const req = {
      householdId: f.household.id,
      kind: "reminder" as const,
      sourceId: await makeReminder(f.household.id, f.members[0]!.id),
      occurrenceKey: new Date().toISOString(),
      target: { memberId: f.members[0]!.id, conversationId: null },
      text: "⏰ once only",
    };
    await dispatcher.dispatch(req);
    await dispatcher.dispatch(req); // crash-retry of the same occurrence
    expect(smsSent).toHaveLength(1);
  });

  test("household fan-out sends to members with phones and records skips for the rest", async () => {
    if (!available) return;
    const f = await fixture({ memberCount: 2 });
    // Member 2 has no phone (identities are unique on type+value, so a truly
    // shared number is represented as one member owning it).
    await db.delete(identities).where(eq(identities.memberId, f.members[1]!.id));
    const { telnyx, smsSent } = fakeTelnyx();
    const dispatcher = new NotificationDispatcher(db, { telnyx });
    const reminderId = await makeReminder(f.household.id, null);
    await dispatcher.dispatch({
      householdId: f.household.id,
      kind: "reminder",
      sourceId: reminderId,
      occurrenceKey: new Date().toISOString(),
      target: { memberId: null, conversationId: null },
      text: "hello household",
    });
    // Member 1 got one SMS; member 2 (no phone) has an explicit skipped row.
    expect(smsSent).toHaveLength(1);
    expect(smsSent[0]!.to).toBe(f.members[0]!.phone);
    const audit = await db.select().from(deliveries).where(eq(deliveries.reminderId, reminderId));
    expect(audit.filter((d) => d.status === "skipped")).toHaveLength(1);
  });

  test("without a Telnyx provider, SMS deliveries are recorded as skipped — never sent to web chat", async () => {
    if (!available) return;
    const f = await fixture();
    const dispatcher = new NotificationDispatcher(db, { telnyx: null });
    const reminderId = await makeReminder(f.household.id, null);
    await dispatcher.dispatch({
      householdId: f.household.id,
      kind: "reminder",
      sourceId: reminderId,
      occurrenceKey: new Date().toISOString(),
      target: { memberId: f.members[0]!.id, conversationId: null },
      text: "no provider",
    });
    const audit = await db.select().from(deliveries).where(eq(deliveries.reminderId, reminderId));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.status).toBe("skipped");
    expect(audit[0]!.error).toContain("Telnyx");
    const appChat = await db
      .select()
      .from(messages)
      .where(eq(messages.channel, "app_chat"));
    expect(appChat.filter((m) => m.text === "no provider")).toHaveLength(0);
  });

  test("iMessage enabled without a configured conversation records an explicit skip", async () => {
    if (!available) return;
    const f = await fixture({ sms: false, imessage: true });
    // Clear the configured conversation.
    await db
      .update(householdNotificationChannels)
      .set({ conversationId: null })
      .where(eq(householdNotificationChannels.householdId, f.household.id));
    const dispatcher = new NotificationDispatcher(db, { telnyx: null });
    const reminderId = await makeReminder(f.household.id, null);
    await dispatcher.dispatch({
      householdId: f.household.id,
      kind: "reminder",
      sourceId: reminderId,
      occurrenceKey: new Date().toISOString(),
      target: { memberId: f.members[0]!.id, conversationId: null },
      text: "nowhere to go",
    });
    const audit = await db.select().from(deliveries).where(eq(deliveries.reminderId, reminderId));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.channel).toBe("imessage");
    expect(audit[0]!.status).toBe("skipped");
  });

  test("provider failure is recorded as failed with the error, not retried blindly", async () => {
    if (!available) return;
    const f = await fixture();
    const telnyx = new TelnyxSmsChannel(db, {
      apiKey: "k",
      fromNumber: "+15550000000",
      fetchFn: (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch,
    });
    const dispatcher = new NotificationDispatcher(db, { telnyx });
    const reminderId = await makeReminder(f.household.id, null);
    const occurrenceKey = new Date().toISOString();
    await dispatcher.dispatch({
      householdId: f.household.id,
      kind: "reminder",
      sourceId: reminderId,
      occurrenceKey,
      target: { memberId: f.members[0]!.id, conversationId: null },
      text: "will fail",
    });
    const audit = await db.select().from(deliveries).where(eq(deliveries.reminderId, reminderId));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.status).toBe("failed");
    expect(audit[0]!.error).toContain("telnyx send failed (500)");

    // Re-dispatch after the ambiguous failure: dedupe prevents a double-send.
    const again = await dispatcher.dispatch({
      householdId: f.household.id,
      kind: "reminder",
      sourceId: reminderId,
      occurrenceKey,
      target: { memberId: f.members[0]!.id, conversationId: null },
      text: "will fail",
    });
    expect(again.results).toHaveLength(0);
  });
});

describe("NotificationDispatcher push channel (integration)", () => {
  test("two devices on one member both alert, with distinct per-device dedupe keys", async () => {
    if (!available) return;
    const f = await fixture({ sms: false, push: true });
    const memberId = f.members[0]!.id;
    await registerDevice(memberId, { environment: "sandbox" });
    await registerDevice(memberId, { environment: "production" });
    const { apns, pushSent } = await fakeApns();
    const dispatcher = new NotificationDispatcher(db, { telnyx: null, apns });

    const reminderId = await makeReminder(f.household.id, memberId);
    const req = {
      householdId: f.household.id,
      kind: "reminder" as const,
      sourceId: reminderId,
      occurrenceKey: new Date().toISOString(),
      target: { memberId, conversationId: null },
      text: "⏰ Reminder: pack lunches",
    };
    await dispatcher.dispatch(req);

    // Both phones alerted; the per-row environment picked the APNs host.
    expect(pushSent).toHaveLength(2);
    expect(pushSent.map((p) => p.host).sort()).toEqual([
      "api.push.apple.com",
      "api.sandbox.push.apple.com",
    ]);

    const audit = await db.select().from(deliveries).where(eq(deliveries.reminderId, reminderId));
    expect(audit).toHaveLength(2);
    expect(audit.every((d) => d.channel === "push" && d.status === "queued")).toBe(true);
    expect(new Set(audit.map((d) => d.dedupeKey)).size).toBe(2);

    // Crash-retry of the same occurrence: nothing re-sends.
    await dispatcher.dispatch(req);
    expect(pushSent).toHaveLength(2);
  });

  test("household broadcast pushes every member's devices and skips members without one", async () => {
    if (!available) return;
    const f = await fixture({ sms: false, push: true, memberCount: 2 });
    await registerDevice(f.members[0]!.id);
    // Member 2 never registered a phone.
    const { apns, pushSent } = await fakeApns();
    const dispatcher = new NotificationDispatcher(db, { telnyx: null, apns });

    const reminderId = await makeReminder(f.household.id, null);
    await dispatcher.dispatch({
      householdId: f.household.id,
      kind: "reminder",
      sourceId: reminderId,
      occurrenceKey: new Date().toISOString(),
      target: { memberId: null, conversationId: null },
      text: "family dinner",
    });

    expect(pushSent).toHaveLength(1);
    const audit = await db.select().from(deliveries).where(eq(deliveries.reminderId, reminderId));
    const skipped = audit.filter((d) => d.status === "skipped");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]!.error).toContain("no registered devices");
  });

  test("a permanently dead token fails the delivery and deactivates the device", async () => {
    if (!available) return;
    const f = await fixture({ sms: false, push: true });
    const device = await registerDevice(f.members[0]!.id);
    const { apns } = await fakeApns(() => ({
      status: 410,
      body: JSON.stringify({ reason: "Unregistered" }),
    }));
    const dispatcher = new NotificationDispatcher(db, { telnyx: null, apns });

    const reminderId = await makeReminder(f.household.id, f.members[0]!.id);
    await dispatcher.dispatch({
      householdId: f.household.id,
      kind: "reminder",
      sourceId: reminderId,
      occurrenceKey: new Date().toISOString(),
      target: { memberId: f.members[0]!.id, conversationId: null },
      text: "going nowhere",
    });

    const audit = await db.select().from(deliveries).where(eq(deliveries.reminderId, reminderId));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.status).toBe("failed");
    expect(audit[0]!.error).toBe("Unregistered");
    const [row] = await db.select().from(pushDevices).where(eq(pushDevices.id, device.id));
    expect(row!.active).toBe(false);
  });

  test("push enabled without APNs configured records explicit skips", async () => {
    if (!available) return;
    const f = await fixture({ sms: false, push: true });
    await registerDevice(f.members[0]!.id);
    const dispatcher = new NotificationDispatcher(db, { telnyx: null, apns: null });

    const reminderId = await makeReminder(f.household.id, f.members[0]!.id);
    await dispatcher.dispatch({
      householdId: f.household.id,
      kind: "reminder",
      sourceId: reminderId,
      occurrenceKey: new Date().toISOString(),
      target: { memberId: f.members[0]!.id, conversationId: null },
      text: "no apns",
    });
    const audit = await db.select().from(deliveries).where(eq(deliveries.reminderId, reminderId));
    expect(audit).toHaveLength(1);
    expect(audit[0]!.status).toBe("skipped");
    expect(audit[0]!.error).toContain("APNs");
  });

  test("push channel disabled means no push deliveries at all", async () => {
    if (!available) return;
    const f = await fixture({ sms: false, push: false });
    await registerDevice(f.members[0]!.id);
    const { apns, pushSent } = await fakeApns();
    const dispatcher = new NotificationDispatcher(db, { telnyx: null, apns });

    const reminderId = await makeReminder(f.household.id, f.members[0]!.id);
    await dispatcher.dispatch({
      householdId: f.household.id,
      kind: "reminder",
      sourceId: reminderId,
      occurrenceKey: new Date().toISOString(),
      target: { memberId: f.members[0]!.id, conversationId: null },
      text: "quiet",
    });
    expect(pushSent).toHaveLength(0);
    const audit = await db.select().from(deliveries).where(eq(deliveries.reminderId, reminderId));
    expect(audit).toHaveLength(0);
  });

  test("task reminders deep-link to the task; bare reminders to themselves", async () => {
    if (!available) return;
    const f = await fixture({ sms: false, push: true });
    await registerDevice(f.members[0]!.id);
    const { apns, pushSent } = await fakeApns();
    const dispatcher = new NotificationDispatcher(db, { telnyx: null, apns });

    const reminderId = await makeReminder(f.household.id, f.members[0]!.id);
    const [reminderRow] = await db.select().from(reminders).where(eq(reminders.id, reminderId));
    await dispatcher.dispatch({
      householdId: f.household.id,
      kind: "reminder",
      sourceId: reminderId,
      taskId: reminderRow!.taskId,
      occurrenceKey: new Date().toISOString(),
      target: { memberId: f.members[0]!.id, conversationId: null },
      text: "still open",
    });
    const payload = JSON.parse(pushSent[0]!.body) as { type?: string; id?: string };
    expect(payload.type).toBe("task");
    expect(payload.id).toBe(reminderRow!.taskId!);
  });
});
