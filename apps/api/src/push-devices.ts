import { and, eq, ne } from "drizzle-orm";
import type { Db } from "@fambot/database";
import { pushDevices } from "@fambot/database";

/**
 * Register (or refresh) one app install's APNs token for a member.
 *
 * Semantics the routes and tests rely on:
 * - Upsert on (memberId, installationId): token rotation updates in place.
 * - A token identifies one physical device, so any *other* row still holding
 *   it (e.g. a reinstall's stale registration) is deactivated first.
 * - Registration always reactivates the row and bumps lastSeenAt.
 */
export async function registerPushDevice(
  db: Db,
  args: {
    memberId: string;
    installationId: string;
    token: string;
    platform: "ios";
    environment: "sandbox" | "production";
  }
) {
  const token = args.token.toLowerCase();
  await db
    .update(pushDevices)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(pushDevices.token, token), ne(pushDevices.installationId, args.installationId)));

  const [device] = await db
    .insert(pushDevices)
    .values({
      memberId: args.memberId,
      installationId: args.installationId,
      platform: args.platform,
      token,
      environment: args.environment,
      active: true,
      lastSeenAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [pushDevices.memberId, pushDevices.installationId],
      set: {
        token,
        environment: args.environment,
        active: true,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning();
  return device!;
}

/** Deactivate one install's registration; scoped to the owning member. */
export async function unregisterPushDevice(
  db: Db,
  args: { memberId: string; installationId: string }
) {
  await db
    .update(pushDevices)
    .set({ active: false, updatedAt: new Date() })
    .where(
      and(
        eq(pushDevices.memberId, args.memberId),
        eq(pushDevices.installationId, args.installationId)
      )
    );
}
