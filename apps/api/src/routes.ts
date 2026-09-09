import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  calendarConnections,
  conversationParticipants,
  conversations,
  households,
  identities,
  members,
  messages,
} from "@fambot/database";
import type { InboundMessage } from "@fambot/shared";
import { exchangeCode, googleAuthUrl, saveConnection, type GoogleConfig } from "@fambot/calendar";
import { auth } from "./auth";
import { db, services } from "./context";
import { env, googleEnabled } from "./env";
import { processInbound } from "./pipeline";
import { getBridgeStatus } from "./bridge-ws";

type Vars = {
  user: { id: string; name: string; email: string };
};

export const api = new Hono<{ Variables: Vars }>();

// --- session middleware -----------------------------------------------------

api.use("*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "unauthorized" }, 401);
  c.set("user", session.user);
  await next();
});

async function requireMember(userId: string, householdId: string) {
  const [member] = await db
    .select()
    .from(members)
    .where(and(eq(members.householdId, householdId), eq(members.userId, userId)));
  return member ?? null;
}

// --- me / households ---------------------------------------------------------

api.get("/me", async (c) => {
  const user = c.get("user");
  const rows = await db
    .select({ member: members, household: households })
    .from(members)
    .innerJoin(households, eq(members.householdId, households.id))
    .where(eq(members.userId, user.id));
  return c.json({
    user: { id: user.id, name: user.name, email: user.email },
    memberships: rows,
    googleAuthEnabled: googleEnabled,
  });
});

const CreateHouseholdSchema = z.object({
  name: z.string().min(1),
  timezone: z.string().default("America/New_York"),
});

api.post("/households", async (c) => {
  const user = c.get("user");
  const body = CreateHouseholdSchema.parse(await c.req.json());
  const [household] = await db
    .insert(households)
    .values({ name: body.name, timezone: body.timezone })
    .returning();
  const [member] = await db
    .insert(members)
    .values({
      householdId: household!.id,
      userId: user.id,
      displayName: user.name || user.email.split("@")[0]!,
      role: "owner",
    })
    .returning();
  return c.json({ household, member });
});

api.get("/households/:hid", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  const member = await requireMember(user.id, hid);
  if (!member) return c.json({ error: "forbidden" }, 403);
  const [household] = await db.select().from(households).where(eq(households.id, hid));
  const memberRows = await db.select().from(members).where(eq(members.householdId, hid));
  const identityRows = await db
    .select()
    .from(identities)
    .where(
      eq(identities.memberId, memberRows[0]?.id ?? "00000000-0000-0000-0000-000000000000")
    );
  // fetch identities for all members
  const allIdentities =
    memberRows.length > 0
      ? await db.select().from(identities)
      : identityRows;
  const memberIds = new Set(memberRows.map((m) => m.id));
  return c.json({
    household,
    members: memberRows,
    identities: allIdentities.filter((i) => memberIds.has(i.memberId)),
    me: member,
    bridge: getBridgeStatus(),
  });
});

const PatchHouseholdSchema = z.object({
  name: z.string().min(1).optional(),
  timezone: z.string().optional(),
  botName: z.string().min(2).optional(),
});

api.patch("/households/:hid", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  const member = await requireMember(user.id, hid);
  if (!member) return c.json({ error: "forbidden" }, 403);
  const body = PatchHouseholdSchema.parse(await c.req.json());
  const [household] = await db.update(households).set(body).where(eq(households.id, hid)).returning();
  return c.json({ household });
});

const AddMemberSchema = z.object({
  displayName: z.string().min(1),
  imessageHandle: z.string().optional(),
});

api.post("/households/:hid/members", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  const me = await requireMember(user.id, hid);
  if (!me) return c.json({ error: "forbidden" }, 403);
  const body = AddMemberSchema.parse(await c.req.json());
  const [member] = await db
    .insert(members)
    .values({ householdId: hid, displayName: body.displayName, role: "member" })
    .returning();
  if (body.imessageHandle) {
    await db
      .insert(identities)
      .values({ memberId: member!.id, type: "imessage", value: body.imessageHandle.trim() })
      .onConflictDoNothing();
  }
  return c.json({ member });
});

// --- chat --------------------------------------------------------------------

async function getOrCreateAppChat(householdId: string, memberId: string) {
  const [existing] = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.householdId, householdId),
        eq(conversations.channel, "app_chat"),
        eq(conversations.ownerMemberId, memberId)
      )
    );
  if (existing) return existing;
  const [conv] = await db
    .insert(conversations)
    .values({
      householdId,
      channel: "app_chat",
      kind: "direct",
      name: "Fambot chat",
      ownerMemberId: memberId,
    })
    .returning();
  await db
    .insert(conversationParticipants)
    .values({ conversationId: conv!.id, memberId })
    .onConflictDoNothing();
  return conv!;
}

api.get("/households/:hid/chat", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  const member = await requireMember(user.id, hid);
  if (!member) return c.json({ error: "forbidden" }, 403);
  const conv = await getOrCreateAppChat(hid, member.id);
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conv.id))
    .orderBy(asc(messages.sentAt))
    .limit(200);
  return c.json({ conversationId: conv.id, messages: rows });
});

const SendMessageSchema = z.object({ text: z.string().min(1).max(4000) });

api.post("/households/:hid/chat", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  const member = await requireMember(user.id, hid);
  if (!member) return c.json({ error: "forbidden" }, 403);
  const body = SendMessageSchema.parse(await c.req.json());
  const conv = await getOrCreateAppChat(hid, member.id);

  const inbound: InboundMessage = {
    id: crypto.randomUUID(),
    channel: "app_chat",
    conversationExternalId: conv.id,
    sender: { externalId: member.id, displayName: member.displayName },
    text: body.text,
    sentAt: new Date().toISOString(),
    context: { isGroup: false, botWasMentioned: true, isReplyToBot: false },
  };
  const result = await processInbound(inbound);
  return c.json({ conversationId: conv.id, reply: result?.reply ?? null });
});

// --- reminders ----------------------------------------------------------------

api.get("/households/:hid/reminders", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  if (!(await requireMember(user.id, hid))) return c.json({ error: "forbidden" }, 403);
  return c.json({ reminders: await services.reminders.list(hid) });
});

const CreateReminderBody = z.object({
  title: z.string().min(1),
  fireAt: z.string().datetime({ offset: true }).nullable().optional(),
  rrule: z.string().nullable().optional(),
});

api.post("/households/:hid/reminders", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  const member = await requireMember(user.id, hid);
  if (!member) return c.json({ error: "forbidden" }, 403);
  const [household] = await db.select().from(households).where(eq(households.id, hid));
  const body = CreateReminderBody.parse(await c.req.json());
  const reminder = await services.reminders.create({
    householdId: hid,
    creatorMemberId: member.id,
    title: body.title,
    targetType: "member",
    targetMemberId: member.id,
    fireAt: body.fireAt ? new Date(body.fireAt) : null,
    rrule: body.rrule ?? null,
    timezone: household!.timezone,
  });
  return c.json({ reminder });
});

api.delete("/households/:hid/reminders/:rid", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  if (!(await requireMember(user.id, hid))) return c.json({ error: "forbidden" }, 403);
  await services.reminders.cancel(c.req.param("rid"));
  return c.json({ ok: true });
});

// --- tasks / lists -------------------------------------------------------------

api.get("/households/:hid/tasks", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  if (!(await requireMember(user.id, hid))) return c.json({ error: "forbidden" }, 403);
  return c.json({ tasks: await services.tasks.list(hid), lists: await services.lists.list(hid) });
});

const CreateTaskBody = z.object({
  title: z.string().min(1),
  notes: z.string().optional(),
  listId: z.string().uuid().nullable().optional(),
  assigneeMemberId: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  nagIntervalMin: z.number().int().min(5).max(1440).optional(),
});

api.post("/households/:hid/tasks", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  const member = await requireMember(user.id, hid);
  if (!member) return c.json({ error: "forbidden" }, 403);
  const [household] = await db.select().from(households).where(eq(households.id, hid));
  const body = CreateTaskBody.parse(await c.req.json());
  const task = await services.tasks.create({
    householdId: hid,
    creatorMemberId: member.id,
    title: body.title,
    notes: body.notes,
    listId: body.listId ?? null,
    assigneeMemberId: body.assigneeMemberId ?? null,
    dueAt: body.dueAt ? new Date(body.dueAt) : null,
    rrule: null,
    timezone: household!.timezone,
    nagIntervalMin: body.nagIntervalMin ?? null,
  });
  return c.json({ task });
});

const PatchTaskBody = z.object({
  status: z.enum(["open", "done", "cancelled"]).optional(),
  title: z.string().min(1).optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  listId: z.string().uuid().nullable().optional(),
});

api.patch("/households/:hid/tasks/:tid", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  if (!(await requireMember(user.id, hid))) return c.json({ error: "forbidden" }, 403);
  const tid = c.req.param("tid");
  const body = PatchTaskBody.parse(await c.req.json());
  if (body.status === "done") {
    const { done, next } = await services.tasks.complete(tid);
    return c.json({ task: done, respawned: next });
  }
  if (body.status === "cancelled") {
    await services.tasks.cancel(tid);
    return c.json({ ok: true });
  }
  const patch: Record<string, unknown> = {};
  if (body.title) patch.title = body.title;
  if (body.dueAt !== undefined) {
    patch.dueAt = body.dueAt ? new Date(body.dueAt) : null;
    patch.nextNudgeAt = body.dueAt ? new Date(body.dueAt) : null;
  }
  if (body.listId !== undefined) patch.listId = body.listId;
  if (body.status === "open") {
    patch.status = "open";
    patch.completedAt = null;
  }
  const task = await services.tasks.update(tid, patch);
  return c.json({ task });
});

const ListBody = z.object({ name: z.string().min(1) });

api.post("/households/:hid/lists", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  const member = await requireMember(user.id, hid);
  if (!member) return c.json({ error: "forbidden" }, 403);
  const body = ListBody.parse(await c.req.json());
  return c.json({ list: await services.lists.create(hid, body.name, member.id) });
});

api.patch("/households/:hid/lists/:lid", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  if (!(await requireMember(user.id, hid))) return c.json({ error: "forbidden" }, 403);
  const body = ListBody.parse(await c.req.json());
  return c.json({ list: await services.lists.rename(c.req.param("lid"), body.name) });
});

api.delete("/households/:hid/lists/:lid", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  const member = await requireMember(user.id, hid);
  if (!member) return c.json({ error: "forbidden" }, 403);
  if (member.role !== "owner") return c.json({ error: "owner only" }, 403);
  await services.lists.remove(c.req.param("lid"));
  return c.json({ ok: true });
});

// --- events --------------------------------------------------------------------

api.get("/households/:hid/events", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  if (!(await requireMember(user.id, hid))) return c.json({ error: "forbidden" }, 403);
  const start = c.req.query("start") ? new Date(c.req.query("start")!) : new Date(Date.now() - 30 * 86_400_000);
  const end = c.req.query("end") ? new Date(c.req.query("end")!) : new Date(Date.now() + 60 * 86_400_000);
  return c.json({ events: await services.events.listRange(hid, start, end) });
});

const CreateEventBody = z.object({
  title: z.string().min(1),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  location: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

api.post("/households/:hid/events", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  const member = await requireMember(user.id, hid);
  if (!member) return c.json({ error: "forbidden" }, 403);
  const body = CreateEventBody.parse(await c.req.json());
  const event = await services.events.create({
    householdId: hid,
    creatorMemberId: member.id,
    title: body.title,
    startsAt: new Date(body.startsAt),
    endsAt: body.endsAt ? new Date(body.endsAt) : null,
    location: body.location ?? null,
    notes: body.notes ?? null,
  });
  return c.json({ event });
});

api.delete("/households/:hid/events/:eid", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  if (!(await requireMember(user.id, hid))) return c.json({ error: "forbidden" }, 403);
  await services.events.remove(c.req.param("eid"));
  return c.json({ ok: true });
});

// --- integrations (Google Calendar OAuth) ---------------------------------------

function googleConfig(): GoogleConfig {
  return {
    clientId: env.GOOGLE_CLIENT_ID!,
    clientSecret: env.GOOGLE_CLIENT_SECRET!,
    redirectUri: `${env.API_BASE_URL}/api/integrations/google/callback`,
    encryptionKey: env.TOKEN_ENCRYPTION_KEY,
  };
}

async function signState(userId: string): Promise<string> {
  const payload = `${userId}.${Date.now()}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.BETTER_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return `${Buffer.from(payload).toString("base64url")}.${Buffer.from(sig).toString("base64url")}`;
}

async function verifyState(state: string): Promise<string | null> {
  const [payloadB64, sigB64] = state.split(".");
  if (!payloadB64 || !sigB64) return null;
  const payload = Buffer.from(payloadB64, "base64url").toString();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.BETTER_AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const ok = await crypto.subtle.verify(
    "HMAC",
    key,
    Buffer.from(sigB64, "base64url"),
    new TextEncoder().encode(payload)
  );
  if (!ok) return null;
  const [userId, ts] = payload.split(".");
  if (!userId || Date.now() - Number(ts) > 10 * 60_000) return null;
  return userId;
}

api.get("/integrations", async (c) => {
  const user = c.get("user");
  const [conn] = await db
    .select({ email: calendarConnections.accountEmail, createdAt: calendarConnections.createdAt })
    .from(calendarConnections)
    .where(eq(calendarConnections.userId, user.id));
  return c.json({
    google: { configured: googleEnabled, connected: Boolean(conn), email: conn?.email ?? null },
    bridge: getBridgeStatus(),
  });
});

api.post("/integrations/google/connect", async (c) => {
  if (!googleEnabled) return c.json({ error: "google oauth not configured on the server" }, 400);
  const user = c.get("user");
  const url = googleAuthUrl(googleConfig(), await signState(user.id));
  return c.json({ url });
});

api.delete("/integrations/google", async (c) => {
  const user = c.get("user");
  await db.delete(calendarConnections).where(eq(calendarConnections.userId, user.id));
  return c.json({ ok: true });
});

// Callback lives outside session middleware (Google redirects the browser).
export const oauthCallback = new Hono();
oauthCallback.get("/api/integrations/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) return c.text("missing code/state", 400);
  const userId = await verifyState(state);
  if (!userId) return c.text("bad state", 400);
  const tokens = await exchangeCode(googleConfig(), code);
  await saveConnection(db, googleConfig(), userId, tokens);
  return c.redirect(`${env.APP_URL}?connected=google`);
});
