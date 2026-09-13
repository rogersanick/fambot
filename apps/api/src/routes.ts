import { Hono } from "hono";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  calendarConnections,
  conversationParticipants,
  conversations,
  householdNotificationChannels,
  householdInvites,
  households,
  identities,
  members,
  messages,
  tasks,
} from "@fambot/database";
import { normalizePhone, type InboundMessage } from "@fambot/shared";
import { createEventEntry } from "@fambot/domain";
import {
  exchangeCode,
  googleAuthUrl,
  GoogleCalendarProvider,
  saveConnection,
  type GoogleConfig,
} from "@fambot/calendar";
import { auth } from "./auth";
import { db, services, telnyxChannel } from "./context";
import { env, googleEnabled, telnyxEnabled } from "./env";
import { processInbound } from "./pipeline";
import { getBridgeStatus } from "./bridge-ws";
import {
  acceptInvite,
  createInviteRecord,
  inviteState,
  markInviteSms,
  MAX_GROUP_RECIPIENTS,
  rotateInviteToken,
  sanitizeInvite,
  getInviteByToken,
} from "./invites";

const SMS_NOT_CONFIGURED = {
  error: "sms_not_configured",
  message:
    "Telnyx SMS isn't ready. Attach a number to a messaging profile, then restart bun dev (it starts the Cloudflare webhook tunnel automatically).",
} as const;

function smsStatus() {
  return {
    configured: telnyxEnabled,
    fromNumber: env.TELNYX_FROM_NUMBER ?? null,
    apiKeySet: Boolean(env.TELNYX_API_KEY),
    inboundReady: Boolean(env.TELNYX_PUBLIC_KEY && env.TELNYX_MESSAGING_PROFILE_ID),
  };
}

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

const PhoneSchema = z
  .string()
  .refine((value) => normalizePhone(value) !== null, "Enter a valid phone number")
  .transform((value) => normalizePhone(value)!);

const CreateHouseholdSchema = z.object({
  name: z.string().min(1),
  timezone: z.string().default("America/New_York"),
  ownerPhone: PhoneSchema,
});

api.post("/households", async (c) => {
  const user = c.get("user");
  const body = CreateHouseholdSchema.parse(await c.req.json());
  const { household, member } = await db.transaction(async (tx) => {
    const [household] = await tx
      .insert(households)
      .values({ name: body.name, timezone: body.timezone })
      .returning();
    const [member] = await tx
      .insert(members)
      .values({
        householdId: household!.id,
        userId: user.id,
        displayName: user.name || user.email.split("@")[0]!,
        role: "owner",
      })
      .returning();
    // Phone is the SMS identity only; iMessage handles are configured
    // separately (an Apple ID email/relay handle may differ from the number).
    await tx
      .insert(identities)
      .values({ memberId: member!.id, type: "phone", value: body.ownerPhone });
    // Default notification channels: SMS broadcasts by default, iMessage opt-in.
    await tx.insert(householdNotificationChannels).values([
      { householdId: household!.id, channel: "sms", enabled: true },
      { householdId: household!.id, channel: "imessage", enabled: false },
    ]);
    return { household: household!, member: member! };
  });
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
  const inviteRows =
    memberRows.length > 0
      ? await db
          .select({ invite: householdInvites, member: members })
          .from(householdInvites)
          .innerJoin(members, eq(householdInvites.memberId, members.id))
          .where(eq(members.householdId, hid))
      : [];
  return c.json({
    household,
    members: memberRows,
    identities: allIdentities.filter((i) => memberIds.has(i.memberId)),
    invites: inviteRows.map(({ invite, member: invitedMember }) => ({
      id: invite.id,
      memberId: invite.memberId,
      displayName: invitedMember.displayName,
      state: inviteState(invite),
      smsStatus: invite.smsStatus,
      sendError: invite.sendError,
      expiresAt: invite.expiresAt.toISOString(),
    })),
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

const CreateInviteSchema = z.object({
  displayName: z.string().trim().min(1).max(100),
  phone: PhoneSchema.refine((phone) => /^\+1\d{10}$/.test(phone), {
    message: "Group MMS currently supports US and Canadian +1 numbers only",
  }),
});

async function sendInviteSms(args: {
  inviteId: string;
  token: string;
  phone: string;
  inviterName: string;
  householdName: string;
}) {
  try {
    // Keep the bearer token in the URL fragment so browsers never send it to
    // the SPA host in request logs or referrer headers.
    const link = `${env.APP_URL.replace(/\/$/, "")}/#invite=${encodeURIComponent(args.token)}`;
    const { providerMessageId } = await telnyxChannel!.sendSms({
      to: args.phone,
      text: `${args.inviterName} invited you to join ${args.householdName} on Fambot. Set up your account: ${link}`,
    });
    await markInviteSms(db, args.inviteId, { status: "queued", providerMessageId });
    return { smsStatus: "queued" as const, sendError: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markInviteSms(db, args.inviteId, { status: "failed", error: message });
    return { smsStatus: "failed" as const, sendError: message };
  }
}

api.post("/households/:hid/invites", async (c) => {
  if (!telnyxChannel) return c.json(SMS_NOT_CONFIGURED, 503);
  const user = c.get("user");
  const hid = c.req.param("hid");
  const me = await requireMember(user.id, hid);
  if (!me) return c.json({ error: "forbidden" }, 403);
  if (me.role !== "owner") return c.json({ error: "owner_only" }, 403);
  const body = CreateInviteSchema.parse(await c.req.json());
  const [household] = await db.select().from(households).where(eq(households.id, hid));
  if (!household) return c.json({ error: "not_found" }, 404);

  const householdPhones = await db
    .select({ phone: identities.value })
    .from(identities)
    .innerJoin(members, eq(identities.memberId, members.id))
    .where(and(eq(members.householdId, hid), eq(identities.type, "phone")));
  if (householdPhones.length >= MAX_GROUP_RECIPIENTS) {
    return c.json({ error: "group_recipient_limit" }, 409);
  }
  if (householdPhones.some(({ phone }) => !/^\+1\d{10}$/.test(phone))) {
    return c.json({ error: "household_not_group_mms_eligible" }, 409);
  }
  const [duplicate] = await db
    .select({ id: identities.id })
    .from(identities)
    .where(and(eq(identities.type, "phone"), eq(identities.value, body.phone)));
  if (duplicate) return c.json({ error: "phone_already_in_use" }, 409);

  const created = await createInviteRecord(db, {
    householdId: hid,
    invitedByMemberId: me.id,
    displayName: body.displayName,
    phone: body.phone,
  });
  const delivery = await sendInviteSms({
    inviteId: created.invite.id,
    token: created.token,
    phone: body.phone,
    inviterName: me.displayName,
    householdName: household.name,
  });
  return c.json(
    {
      member: created.member,
      invite: {
        id: created.invite.id,
        memberId: created.member.id,
        displayName: created.member.displayName,
        state: "pending" as const,
        expiresAt: created.invite.expiresAt.toISOString(),
        ...delivery,
      },
    },
    201
  );
});

const InviteTokenSchema = z.object({ token: z.string().min(20).max(200) });

api.post("/invites/preview", async (c) => {
  const { token } = InviteTokenSchema.parse(await c.req.json());
  const row = await getInviteByToken(db, token);
  const invite = sanitizeInvite(row);
  if (!invite) return c.json({ error: "invite_not_found" }, 404);
  return c.json({ invite });
});

api.post("/invites/accept", async (c) => {
  const { token } = InviteTokenSchema.parse(await c.req.json());
  const result = await acceptInvite(db, token, c.get("user").id);
  if (result.ok) return c.json(result);
  const status = result.reason === "not_found" ? 404 : 409;
  return c.json({ error: result.reason }, status);
});

api.post("/households/:hid/invites/:iid/resend", async (c) => {
  if (!telnyxChannel) return c.json(SMS_NOT_CONFIGURED, 503);
  const hid = c.req.param("hid");
  const me = await requireMember(c.get("user").id, hid);
  if (!me) return c.json({ error: "forbidden" }, 403);
  if (me.role !== "owner") return c.json({ error: "owner_only" }, 403);
  const [row] = await db
    .select({
      invite: householdInvites,
      member: members,
      phone: identities.value,
      household: households,
    })
    .from(householdInvites)
    .innerJoin(members, eq(householdInvites.memberId, members.id))
    .innerJoin(households, eq(members.householdId, households.id))
    .innerJoin(
      identities,
      and(eq(identities.memberId, members.id), eq(identities.type, "phone"))
    )
    .where(and(eq(householdInvites.id, c.req.param("iid")), eq(members.householdId, hid)));
  if (!row) return c.json({ error: "invite_not_found" }, 404);
  const rotated = await rotateInviteToken(db, row.invite.id);
  if (!rotated) return c.json({ error: "invite_already_accepted" }, 409);
  const delivery = await sendInviteSms({
    inviteId: row.invite.id,
    token: rotated.token,
    phone: row.phone,
    inviterName: me.displayName,
    householdName: row.household.name,
  });
  return c.json({
    invite: {
      id: rotated.invite.id,
      memberId: row.member.id,
      displayName: row.member.displayName,
      state: "pending" as const,
      expiresAt: rotated.invite.expiresAt.toISOString(),
      ...delivery,
    },
  });
});

api.delete("/households/:hid/invites/:iid", async (c) => {
  const hid = c.req.param("hid");
  const me = await requireMember(c.get("user").id, hid);
  if (!me) return c.json({ error: "forbidden" }, 403);
  if (me.role !== "owner") return c.json({ error: "owner_only" }, 403);
  const [row] = await db
    .select({ member: members, invite: householdInvites })
    .from(householdInvites)
    .innerJoin(members, eq(householdInvites.memberId, members.id))
    .where(and(eq(householdInvites.id, c.req.param("iid")), eq(members.householdId, hid)));
  if (!row) return c.json({ error: "invite_not_found" }, 404);
  if (row.member.userId || row.invite.acceptedAt) {
    return c.json({ error: "invite_already_accepted" }, 409);
  }
  await db.delete(members).where(eq(members.id, row.member.id));
  return c.json({ ok: true });
});

async function requireEditableMember(c: {
  req: { param(name: string): string };
}, userId: string) {
  const hid = c.req.param("hid");
  const actingMember = await requireMember(userId, hid);
  if (!actingMember) return null;
  const [targetMember] = await db
    .select()
    .from(members)
    .where(and(eq(members.id, c.req.param("mid")), eq(members.householdId, hid)));
  if (!targetMember) return null;
  if (actingMember.role !== "owner" && actingMember.id !== targetMember.id) return null;
  return targetMember;
}

const SetMemberPhoneSchema = z.object({
  phone: PhoneSchema,
});

/** Updates only the SMS phone identity; iMessage handles are managed separately. */
api.patch("/households/:hid/members/:mid/phone", async (c) => {
  const targetMember = await requireEditableMember(c, c.get("user").id);
  if (!targetMember) return c.json({ error: "forbidden" }, 403);

  const { phone } = SetMemberPhoneSchema.parse(await c.req.json());
  await db.transaction(async (tx) => {
    await tx
      .delete(identities)
      .where(and(eq(identities.memberId, targetMember.id), eq(identities.type, "phone")));
    await tx.insert(identities).values({ memberId: targetMember.id, type: "phone", value: phone });
  });
  return c.json({ phone });
});

const SetMemberImessageSchema = z.object({
  /** E.164 number or Apple ID email; null clears the handle. */
  handle: z.string().trim().min(3).nullable(),
});

api.patch("/households/:hid/members/:mid/imessage", async (c) => {
  const targetMember = await requireEditableMember(c, c.get("user").id);
  if (!targetMember) return c.json({ error: "forbidden" }, 403);

  const { handle } = SetMemberImessageSchema.parse(await c.req.json());
  await db.transaction(async (tx) => {
    await tx
      .delete(identities)
      .where(and(eq(identities.memberId, targetMember.id), eq(identities.type, "imessage")));
    if (handle) {
      await tx.insert(identities).values({ memberId: targetMember.id, type: "imessage", value: handle });
    }
  });
  return c.json({ handle });
});

// --- household notification channels ------------------------------------------

async function getOrCreateChannels(householdId: string) {
  const existing = await db
    .select()
    .from(householdNotificationChannels)
    .where(eq(householdNotificationChannels.householdId, householdId));
  if (existing.length >= 2) return existing;
  // Households created before channels existed: seed the defaults on read.
  await db
    .insert(householdNotificationChannels)
    .values([
      { householdId, channel: "sms", enabled: true },
      { householdId, channel: "imessage", enabled: false },
    ])
    .onConflictDoNothing();
  return db
    .select()
    .from(householdNotificationChannels)
    .where(eq(householdNotificationChannels.householdId, householdId));
}

api.get("/households/:hid/notification-channels", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  if (!(await requireMember(user.id, hid))) return c.json({ error: "forbidden" }, 403);
  const channels = await getOrCreateChannels(hid);
  const imessageConversations = await db
    .select({ id: conversations.id, name: conversations.name, kind: conversations.kind })
    .from(conversations)
    .where(and(eq(conversations.householdId, hid), eq(conversations.channel, "imessage")));
  return c.json({
    channels,
    imessageConversations,
    sms: smsStatus(),
    bridge: getBridgeStatus(),
  });
});

const PutChannelSchema = z.object({
  channel: z.enum(["sms", "imessage"]),
  enabled: z.boolean(),
  conversationId: z.string().uuid().nullable().optional(),
});

api.put("/households/:hid/notification-channels", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  const me = await requireMember(user.id, hid);
  if (!me) return c.json({ error: "forbidden" }, 403);
  if (me.role !== "owner") return c.json({ error: "owner only" }, 403);
  const body = PutChannelSchema.parse(await c.req.json());

  if (body.conversationId) {
    const [conv] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.id, body.conversationId),
          eq(conversations.householdId, hid),
          eq(conversations.channel, "imessage")
        )
      );
    if (!conv) return c.json({ error: "conversation not found in this household" }, 400);
  }

  await getOrCreateChannels(hid);
  const [channel] = await db
    .update(householdNotificationChannels)
    .set({
      enabled: body.enabled,
      ...(body.channel === "imessage" && body.conversationId !== undefined
        ? { conversationId: body.conversationId }
        : {}),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(householdNotificationChannels.householdId, hid),
        eq(householdNotificationChannels.channel, body.channel)
      )
    )
    .returning();
  return c.json({ channel });
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
  return c.json({
    tasks: await services.tasks.list(hid),
    lists: await services.lists.list(hid),
    series: await services.taskSeries.list(hid),
  });
});

const CreateTaskBody = z.object({
  title: z.string().min(1),
  notes: z.string().optional(),
  listId: z.string().uuid().nullable().optional(),
  assigneeMemberId: z.string().uuid().nullable().optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  nagIntervalMin: z.number().int().min(5).max(1440).optional(),
  /** RFC-5545 recurrence; requires dueAt (the first occurrence). */
  rrule: z.string().min(1).nullable().optional(),
});

api.post("/households/:hid/tasks", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  const member = await requireMember(user.id, hid);
  if (!member) return c.json({ error: "forbidden" }, 403);
  const [household] = await db.select().from(households).where(eq(households.id, hid));
  const body = CreateTaskBody.parse(await c.req.json());
  if (body.listId && !(await services.lists.get(hid, body.listId))) {
    return c.json({ error: "list_not_found" }, 404);
  }
  if (body.rrule) {
    if (!body.dueAt) return c.json({ error: "a recurring todo needs a first due date" }, 400);
    const { series, task } = await services.taskSeries.create({
      householdId: hid,
      creatorMemberId: member.id,
      title: body.title,
      notes: body.notes,
      listId: body.listId ?? null,
      assigneeMemberId: body.assigneeMemberId ?? null,
      firstDueAt: new Date(body.dueAt),
      rrule: body.rrule,
      timezone: household!.timezone,
      nagIntervalMin: body.nagIntervalMin ?? null,
    });
    return c.json({ task, series });
  }
  const task = await services.tasks.create({
    householdId: hid,
    creatorMemberId: member.id,
    title: body.title,
    notes: body.notes,
    listId: body.listId ?? null,
    assigneeMemberId: body.assigneeMemberId ?? null,
    dueAt: body.dueAt ? new Date(body.dueAt) : null,
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
  nagIntervalMin: z.number().int().min(5).max(1440).optional(),
});

api.patch("/households/:hid/tasks/:tid", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  if (!(await requireMember(user.id, hid))) return c.json({ error: "forbidden" }, 403);
  const tid = c.req.param("tid");
  const [existing] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, tid), eq(tasks.householdId, hid)));
  if (!existing) return c.json({ error: "not_found" }, 404);
  const body = PatchTaskBody.parse(await c.req.json());
  if (body.listId && !(await services.lists.get(hid, body.listId))) {
    return c.json({ error: "list_not_found" }, 404);
  }
  if (body.status === "done") {
    const done = await services.tasks.complete(tid);
    return c.json({ task: done });
  }
  if (body.status === "cancelled") {
    await services.tasks.cancel(tid);
    return c.json({ ok: true });
  }
  const patch: Record<string, unknown> = {};
  if (body.title) patch.title = body.title;
  if (body.dueAt !== undefined) {
    // Postpone/reschedule THIS occurrence only: dueAt is the effective
    // deadline, scheduledFor keeps the series slot untouched.
    patch.dueAt = body.dueAt ? new Date(body.dueAt) : null;
    patch.nextNudgeAt = body.dueAt ? new Date(body.dueAt) : null;
  }
  if (body.listId !== undefined) patch.listId = body.listId;
  if (body.nagIntervalMin !== undefined) {
    patch.nagIntervalMin = body.nagIntervalMin;
    // Predictable cadence reset: overdue → next nudge one interval from now;
    // future-due → nudging still starts at the due time.
    const effectiveDue = (patch.dueAt as Date | null | undefined) ?? existing.dueAt;
    if (existing.status === "open" && effectiveDue) {
      patch.nextNudgeAt =
        effectiveDue.getTime() <= Date.now()
          ? new Date(Date.now() + body.nagIntervalMin * 60_000)
          : effectiveDue;
    }
  }
  if (body.status === "open") {
    patch.status = "open";
    patch.completedAt = null;
    // Reopen: overdue resumes nudging now, future resumes at its due time.
    const effectiveDue = (patch.dueAt as Date | null | undefined) ?? existing.dueAt;
    patch.nextNudgeAt = effectiveDue
      ? effectiveDue.getTime() <= Date.now()
        ? new Date()
        : effectiveDue
      : null;
  }
  const task = await services.tasks.update(tid, patch);
  return c.json({ task });
});

// --- recurring task series -------------------------------------------------------

const PatchSeriesBody = z.object({
  title: z.string().min(1).optional(),
  rrule: z.string().min(1).optional(),
  nagIntervalMin: z.number().int().min(5).max(1440).optional(),
  listId: z.string().uuid().nullable().optional(),
  assigneeMemberId: z.string().uuid().nullable().optional(),
});

api.patch("/households/:hid/task-series/:sid", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  if (!(await requireMember(user.id, hid))) return c.json({ error: "forbidden" }, 403);
  const body = PatchSeriesBody.parse(await c.req.json());
  if (body.listId && !(await services.lists.get(hid, body.listId))) {
    return c.json({ error: "list_not_found" }, 404);
  }
  const series = await services.taskSeries.update(hid, c.req.param("sid"), body);
  if (!series) return c.json({ error: "not_found" }, 404);
  return c.json({ series });
});

api.delete("/households/:hid/task-series/:sid", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  if (!(await requireMember(user.id, hid))) return c.json({ error: "forbidden" }, 403);
  const series = await services.taskSeries.cancel(hid, c.req.param("sid"));
  if (!series) return c.json({ error: "not_found" }, 404);
  return c.json({ ok: true });
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
  const list = await services.lists.rename(hid, c.req.param("lid"), body.name);
  if (!list) return c.json({ error: "not_found" }, 404);
  return c.json({ list });
});

api.delete("/households/:hid/lists/:lid", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  const member = await requireMember(user.id, hid);
  if (!member) return c.json({ error: "forbidden" }, 403);
  if (member.role !== "owner") return c.json({ error: "owner only" }, 403);
  const removed = await services.lists.remove(hid, c.req.param("lid"));
  if (!removed) return c.json({ error: "not_found" }, 404);
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
  /** RFC-5545 recurrence; startsAt is the first occurrence. */
  rrule: z.string().min(1).nullable().optional(),
});

api.post("/households/:hid/events", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  const member = await requireMember(user.id, hid);
  if (!member) return c.json({ error: "forbidden" }, 403);
  const [household] = await db.select().from(households).where(eq(households.id, hid));
  const body = CreateEventBody.parse(await c.req.json());
  // Same orchestration as the chat path: Google gets the series when connected.
  const externalCalendar = googleEnabled
    ? await GoogleCalendarProvider.forUser(db, googleConfig(), user.id)
    : null;
  const { event } = await createEventEntry({
    services,
    externalCalendar,
    householdId: hid,
    creatorMemberId: member.id,
    title: body.title,
    startsAt: new Date(body.startsAt),
    endsAt: body.endsAt ? new Date(body.endsAt) : null,
    location: body.location ?? null,
    notes: body.notes ?? null,
    rrule: body.rrule ?? null,
    timezone: household!.timezone,
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

// --- comments ------------------------------------------------------------------

const commentSubjectByPath = { tasks: "task", events: "event", lists: "list" } as const;

const CreateCommentBody = z.object({ body: z.string().min(1).max(4000) });

api.get("/households/:hid/:subject{tasks|events|lists}/:sid/comments", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  if (!(await requireMember(user.id, hid))) return c.json({ error: "forbidden" }, 403);
  const type = commentSubjectByPath[c.req.param("subject") as keyof typeof commentSubjectByPath];
  const rows = await services.comments.listBySubject(hid, { type, id: c.req.param("sid") });
  if (!rows) return c.json({ error: "not_found" }, 404);
  return c.json({ comments: rows });
});

api.post("/households/:hid/:subject{tasks|events|lists}/:sid/comments", async (c) => {
  const user = c.get("user");
  const hid = c.req.param("hid");
  const member = await requireMember(user.id, hid);
  if (!member) return c.json({ error: "forbidden" }, 403);
  const type = commentSubjectByPath[c.req.param("subject") as keyof typeof commentSubjectByPath];
  const body = CreateCommentBody.parse(await c.req.json());
  const comment = await services.comments.add({
    householdId: hid,
    subject: { type, id: c.req.param("sid") },
    authorMemberId: member.id,
    body: body.body,
  });
  if (!comment) return c.json({ error: "not_found" }, 404);
  return c.json({ comment });
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
    sms: smsStatus(),
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
