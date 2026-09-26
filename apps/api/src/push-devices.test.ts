import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createDb, households, members, pushDevices, type Db } from "@fambot/database";
import { registerPushDevice, unregisterPushDevice } from "./push-devices";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:fambot@localhost:5433/fambot";
let db: Db;
let available = false;

beforeAll(async () => {
  db = createDb(DATABASE_URL);
  try {
    await db.execute("select 1" as never);
    available = true;
  } catch {
    console.warn("[push-devices.test] local Postgres unavailable — skipping integration tests");
  }
});

async function fixture() {
  const [household] = await db
    .insert(households)
    .values({ name: `push-${randomUUID().slice(0, 8)}` })
    .returning();
  const [owner] = await db
    .insert(members)
    .values({ householdId: household!.id, displayName: "Owner", role: "owner" })
    .returning();
  const [other] = await db
    .insert(members)
    .values({ householdId: household!.id, displayName: "Other" })
    .returning();
  return { household: household!, owner: owner!, other: other! };
}

const hexToken = () => randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");

describe("registerPushDevice (integration)", () => {
  test("registers, then upserts in place when the token rotates", async () => {
    if (!available) return;
    const f = await fixture();
    const installationId = randomUUID();

    const first = await registerPushDevice(db, {
      memberId: f.owner.id,
      installationId,
      token: hexToken().toUpperCase(), // stored lowercased
      platform: "ios",
      environment: "sandbox",
    });
    expect(first.active).toBe(true);
    expect(first.token).toBe(first.token.toLowerCase());

    const rotated = hexToken();
    const second = await registerPushDevice(db, {
      memberId: f.owner.id,
      installationId,
      token: rotated,
      platform: "ios",
      environment: "sandbox",
    });
    expect(second.id).toBe(first.id); // same row, not a new one
    expect(second.token).toBe(rotated);

    const rows = await db
      .select()
      .from(pushDevices)
      .where(eq(pushDevices.memberId, f.owner.id));
    expect(rows).toHaveLength(1);
  });

  test("a reinstall carrying the same token retires the stale row", async () => {
    if (!available) return;
    const f = await fixture();
    const token = hexToken();
    const stale = await registerPushDevice(db, {
      memberId: f.owner.id,
      installationId: randomUUID(),
      token,
      platform: "ios",
      environment: "sandbox",
    });
    const fresh = await registerPushDevice(db, {
      memberId: f.owner.id,
      installationId: randomUUID(), // new install, recycled token
      token,
      platform: "ios",
      environment: "sandbox",
    });
    const [staleRow] = await db.select().from(pushDevices).where(eq(pushDevices.id, stale.id));
    expect(staleRow!.active).toBe(false);
    expect(fresh.active).toBe(true);
  });

  test("unregister deactivates only the caller's own install", async () => {
    if (!available) return;
    const f = await fixture();
    const installationId = randomUUID();
    await registerPushDevice(db, {
      memberId: f.owner.id,
      installationId,
      token: hexToken(),
      platform: "ios",
      environment: "production",
    });

    // Another member "guessing" the installation id must not deactivate it.
    await unregisterPushDevice(db, { memberId: f.other.id, installationId });
    let [row] = await db
      .select()
      .from(pushDevices)
      .where(
        and(eq(pushDevices.memberId, f.owner.id), eq(pushDevices.installationId, installationId))
      );
    expect(row!.active).toBe(true);

    await unregisterPushDevice(db, { memberId: f.owner.id, installationId });
    [row] = await db
      .select()
      .from(pushDevices)
      .where(
        and(eq(pushDevices.memberId, f.owner.id), eq(pushDevices.installationId, installationId))
      );
    expect(row!.active).toBe(false);
  });
});
