import { beforeAll, describe, expect, test } from "bun:test";
import { randomInt, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  createDb,
  householdInvites,
  households,
  members,
  user,
  type Db,
} from "@fambot/database";
import {
  acceptInvite,
  createInviteRecord,
  getInviteByToken,
  hashInviteToken,
  inviteExpiresAt,
  INVITE_TTL_MS,
  newInviteToken,
} from "./invites";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:fambot@localhost:5433/fambot";
let db: Db;
let available = false;

beforeAll(async () => {
  db = createDb(DATABASE_URL);
  try {
    await db.execute("select 1" as never);
    available = true;
  } catch {
    console.warn("[invites.test] local Postgres unavailable — skipping integration tests");
  }
});

function phone() {
  return `+1555${String(randomInt(0, 10_000_000)).padStart(7, "0")}`;
}

async function fixture() {
  const userId = `user-${randomUUID()}`;
  await db.insert(user).values({
    id: userId,
    name: "Invitee",
    email: `${userId}@example.com`,
    emailVerified: true,
  });
  const [household] = await db
    .insert(households)
    .values({ name: `Family ${randomUUID()}` })
    .returning();
  const [owner] = await db
    .insert(members)
    .values({
      householdId: household!.id,
      displayName: "Owner",
      role: "owner",
    })
    .returning();
  const created = await createInviteRecord(db, {
    householdId: household!.id,
    invitedByMemberId: owner!.id,
    displayName: "Invitee",
    phone: phone(),
  });
  return { userId, household: household!, created };
}

describe("household invite tokens", () => {
  test("generates opaque, unique 256-bit bearer tokens", () => {
    const first = newInviteToken();
    const second = newInviteToken();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThanOrEqual(43);
    expect(first).not.toContain("+");
    expect(first).not.toContain("/");
  });

  test("stores a deterministic SHA-256 digest instead of the bearer token", () => {
    const token = "invite-token";
    const digest = hashInviteToken(token);
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain(token);
    expect(hashInviteToken(token)).toBe(digest);
    expect(hashInviteToken(`${token}-other`)).not.toBe(digest);
  });

  test("expires invitations after seven days", () => {
    const now = new Date("2026-09-09T12:00:00.000Z");
    expect(inviteExpiresAt(now).getTime() - now.getTime()).toBe(INVITE_TTL_MS);
  });
});

describe("household invite claiming (integration)", () => {
  test("stores only the digest and atomically links the invited member", async () => {
    if (!available) return;
    const { userId, household, created } = await fixture();
    expect(created.invite.tokenHash).toBe(hashInviteToken(created.token));
    expect(created.invite.tokenHash).not.toBe(created.token);

    const claimed = await acceptInvite(db, created.token, userId);
    expect(claimed).toEqual({
      ok: true,
      householdId: household.id,
      memberId: created.member.id,
    });
    const [member] = await db.select().from(members).where(eq(members.id, created.member.id));
    expect(member!.userId).toBe(userId);
    const row = await getInviteByToken(db, created.token);
    expect(row!.invite.acceptedAt).not.toBeNull();

    // Network retries by the same authenticated user are harmless.
    expect(await acceptInvite(db, created.token, userId)).toEqual(claimed);
  });

  test("rejects expired invitations", async () => {
    if (!available) return;
    const { userId, created } = await fixture();
    await db
      .update(householdInvites)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(householdInvites.id, created.invite.id));
    expect(await acceptInvite(db, created.token, userId)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  test("enforces one household per account", async () => {
    if (!available) return;
    const { userId, created } = await fixture();
    const [otherHousehold] = await db
      .insert(households)
      .values({ name: `Other ${randomUUID()}` })
      .returning();
    await db.insert(members).values({
      householdId: otherHousehold!.id,
      userId,
      displayName: "Existing member",
      role: "member",
    });
    expect(await acceptInvite(db, created.token, userId)).toEqual({
      ok: false,
      reason: "already_member",
    });
  });
});
