import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@fambot/database";
import { householdInvites, households, identities, members } from "@fambot/database";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_GROUP_RECIPIENTS = 8;

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function inviteExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_MS);
}

export async function createInviteRecord(
  db: Db,
  args: {
    householdId: string;
    invitedByMemberId: string;
    displayName: string;
    phone: string;
  }
) {
  const token = newInviteToken();
  const result = await db.transaction(async (tx) => {
    const [member] = await tx
      .insert(members)
      .values({
        householdId: args.householdId,
        displayName: args.displayName,
        role: "member",
      })
      .returning();
    await tx.insert(identities).values({
      memberId: member!.id,
      type: "phone",
      value: args.phone,
    });
    const [invite] = await tx
      .insert(householdInvites)
      .values({
        memberId: member!.id,
        invitedByMemberId: args.invitedByMemberId,
        tokenHash: hashInviteToken(token),
        expiresAt: inviteExpiresAt(),
      })
      .returning();
    return { member: member!, invite: invite! };
  });
  return { ...result, token };
}

export async function getInviteByToken(db: Db, token: string) {
  const [row] = await db
    .select({
      invite: householdInvites,
      member: members,
      household: households,
    })
    .from(householdInvites)
    .innerJoin(members, eq(householdInvites.memberId, members.id))
    .innerJoin(households, eq(members.householdId, households.id))
    .where(eq(householdInvites.tokenHash, hashInviteToken(token)));
  return row ?? null;
}

export function inviteState(invite: typeof householdInvites.$inferSelect) {
  if (invite.acceptedAt) return "accepted" as const;
  if (invite.expiresAt.getTime() <= Date.now()) return "expired" as const;
  return "pending" as const;
}

export function sanitizeInvite(row: Awaited<ReturnType<typeof getInviteByToken>>) {
  if (!row) return null;
  return {
    id: row.invite.id,
    household: { id: row.household.id, name: row.household.name },
    member: {
      id: row.member.id,
      displayName: row.member.displayName,
      phone: null as string | null,
    },
    expiresAt: row.invite.expiresAt.toISOString(),
    state: inviteState(row.invite),
    smsStatus: row.invite.smsStatus,
  };
}

export async function rotateInviteToken(db: Db, inviteId: string) {
  const token = newInviteToken();
  const [invite] = await db
    .update(householdInvites)
    .set({
      tokenHash: hashInviteToken(token),
      expiresAt: inviteExpiresAt(),
      smsStatus: "pending",
      providerMessageId: null,
      sendError: null,
      sentAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(householdInvites.id, inviteId), isNull(householdInvites.acceptedAt)))
    .returning();
  return invite ? { invite, token } : null;
}

export async function markInviteSms(
  db: Db,
  inviteId: string,
  update:
    | { status: "queued"; providerMessageId: string }
    | { status: "failed"; error: string }
) {
  await db
    .update(householdInvites)
    .set({
      smsStatus: update.status,
      providerMessageId: update.status === "queued" ? update.providerMessageId : null,
      sendError: update.status === "failed" ? update.error : null,
      sentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(householdInvites.id, inviteId));
}

export type AcceptInviteResult =
  | { ok: true; householdId: string; memberId: string }
  | { ok: false; reason: "not_found" | "expired" | "already_claimed" | "already_member" };

export async function acceptInvite(
  db: Db,
  token: string,
  userId: string
): Promise<AcceptInviteResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ invite: householdInvites, member: members })
      .from(householdInvites)
      .innerJoin(members, eq(householdInvites.memberId, members.id))
      .where(eq(householdInvites.tokenHash, hashInviteToken(token)));
    if (!row) return { ok: false, reason: "not_found" };
    if (row.member.userId === userId && row.invite.acceptedAt) {
      return { ok: true, householdId: row.member.householdId, memberId: row.member.id };
    }
    if (row.invite.acceptedAt || row.member.userId) return { ok: false, reason: "already_claimed" };
    if (row.invite.expiresAt.getTime() <= Date.now()) return { ok: false, reason: "expired" };

    const [existing] = await tx
      .select({ id: members.id })
      .from(members)
      .where(eq(members.userId, userId));
    if (existing) return { ok: false, reason: "already_member" };

    const claimed = await tx
      .update(members)
      .set({ userId })
      .where(and(eq(members.id, row.member.id), isNull(members.userId)))
      .returning({ id: members.id });
    if (!claimed[0]) return { ok: false, reason: "already_claimed" };
    await tx
      .update(householdInvites)
      .set({ acceptedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(householdInvites.id, row.invite.id), isNull(householdInvites.acceptedAt)));
    return { ok: true, householdId: row.member.householdId, memberId: row.member.id };
  });
}

