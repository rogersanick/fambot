import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@fambot/database";
import {
  conversationParticipants,
  conversations,
  deliveries,
  reminders,
  tasks,
} from "@fambot/database";
import { nextOccurrence } from "@fambot/domain";
import type { MessagingChannel } from "@fambot/messaging";

/**
 * Lease-based claims: claiming bumps the due timestamp ~2 minutes into the
 * future inside a single UPDATE ... FOR UPDATE SKIP LOCKED, so concurrent
 * workers never double-claim and a crash mid-delivery retries automatically.
 */

export async function runWorkerOnce(db: Db, channel: MessagingChannel) {
  const fired = await fireDueReminders(db, channel);
  const nudged = await nudgeDueTasks(db, channel);
  return { fired, nudged };
}

// --- reminders ---------------------------------------------------------------

async function fireDueReminders(db: Db, channel: MessagingChannel): Promise<number> {
  const claimed = await db.execute(sql`
    UPDATE reminders SET next_fire_at = now() + interval '2 minutes'
    WHERE id IN (
      SELECT id FROM reminders
      WHERE status = 'scheduled' AND next_fire_at <= now()
      ORDER BY next_fire_at
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, household_id, title, target_type, target_member_id, target_conversation_id,
              fire_at, rrule, timezone, created_at
  `);

  let count = 0;
  for (const row of claimed.rows as Array<Record<string, unknown>>) {
    const id = row.id as string;
    const title = row.title as string;
    const tz = row.timezone as string;
    const rrule = row.rrule as string | null;
    const fireAt = row.fire_at ? new Date(row.fire_at as string) : new Date(row.created_at as string);

    const conversationId = await resolveDeliveryConversation(db, {
      householdId: row.household_id as string,
      targetType: row.target_type as "member" | "conversation",
      targetMemberId: row.target_member_id as string | null,
      targetConversationId: row.target_conversation_id as string | null,
    });

    const [delivery] = await db
      .insert(deliveries)
      .values({
        kind: "reminder",
        reminderId: id,
        conversationId,
        memberId: (row.target_member_id as string | null) ?? null,
        channel: conversationId ? await channelOf(db, conversationId) : "app_chat",
        scheduledFor: new Date(),
        attemptCount: 1,
      })
      .returning({ id: deliveries.id });

    let ok = false;
    if (conversationId) {
      try {
        await channel.sendMessage({ conversationId, text: `⏰ Reminder: ${title}` });
        ok = true;
      } catch (err) {
        console.error(`[worker] reminder ${id} delivery failed:`, err);
      }
    }

    await db
      .update(deliveries)
      .set({ status: ok ? "sent" : "failed", deliveredAt: ok ? new Date() : null, error: ok ? null : "delivery failed" })
      .where(eq(deliveries.id, delivery!.id));

    // Compute next occurrence / completion regardless of delivery result —
    // a failed occurrence is recorded in deliveries, not re-fired forever.
    if (rrule) {
      const next = nextOccurrence(rrule, tz, fireAt, new Date());
      if (next) {
        await db.update(reminders).set({ nextFireAt: next, updatedAt: new Date() }).where(eq(reminders.id, id));
      } else {
        await db.update(reminders).set({ status: "done", nextFireAt: null, updatedAt: new Date() }).where(eq(reminders.id, id));
      }
    } else {
      await db.update(reminders).set({ status: "done", nextFireAt: null, updatedAt: new Date() }).where(eq(reminders.id, id));
    }
    count++;
  }
  return count;
}

// --- task nudges ---------------------------------------------------------------

async function nudgeDueTasks(db: Db, channel: MessagingChannel): Promise<number> {
  const claimed = await db.execute(sql`
    UPDATE tasks SET next_nudge_at = now() + (nag_interval_min * interval '1 minute')
    WHERE id IN (
      SELECT id FROM tasks
      WHERE status = 'open' AND next_nudge_at IS NOT NULL AND next_nudge_at <= now()
      ORDER BY next_nudge_at
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, household_id, title, assignee_member_id, creator_member_id, conversation_id, nag_interval_min
  `);

  let count = 0;
  for (const row of claimed.rows as Array<Record<string, unknown>>) {
    const id = row.id as string;
    const title = row.title as string;
    const conversationId = await resolveDeliveryConversation(db, {
      householdId: row.household_id as string,
      targetType: "member",
      targetMemberId:
        (row.assignee_member_id as string | null) ?? (row.creator_member_id as string | null),
      targetConversationId: row.conversation_id as string | null,
    });

    const [delivery] = await db
      .insert(deliveries)
      .values({
        kind: "task_nudge",
        taskId: id,
        conversationId,
        memberId: (row.assignee_member_id as string | null) ?? null,
        channel: conversationId ? await channelOf(db, conversationId) : "app_chat",
        scheduledFor: new Date(),
        attemptCount: 1,
      })
      .returning({ id: deliveries.id });

    let ok = false;
    if (conversationId) {
      try {
        await channel.sendMessage({
          conversationId,
          text: `⏰ Still open: ${title} — reply "done" when it's finished.`,
        });
        ok = true;
      } catch (err) {
        console.error(`[worker] task nudge ${id} failed:`, err);
      }
    }
    await db
      .update(deliveries)
      .set({ status: ok ? "sent" : "failed", deliveredAt: ok ? new Date() : null, error: ok ? null : "delivery failed" })
      .where(eq(deliveries.id, delivery!.id));
    count++;
  }
  return count;
}

// --- helpers --------------------------------------------------------------------

/**
 * Conversation targets deliver to that conversation. Member targets prefer
 * the member's app chat; fall back to the conversation the item came from.
 */
async function resolveDeliveryConversation(
  db: Db,
  target: {
    householdId: string;
    targetType: "member" | "conversation";
    targetMemberId: string | null;
    targetConversationId: string | null;
  }
): Promise<string | null> {
  if (target.targetType === "conversation" && target.targetConversationId) {
    return target.targetConversationId;
  }
  if (target.targetMemberId) {
    const [appChat] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(
        and(
          eq(conversations.householdId, target.householdId),
          eq(conversations.channel, "app_chat"),
          eq(conversations.ownerMemberId, target.targetMemberId)
        )
      );
    if (appChat) return appChat.id;
    // No app chat: fall back to origin conversation, then any conversation
    // the member participates in.
    if (target.targetConversationId) return target.targetConversationId;
    const [participant] = await db
      .select({ conversationId: conversationParticipants.conversationId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.memberId, target.targetMemberId))
      .limit(1);
    return participant?.conversationId ?? null;
  }
  return target.targetConversationId;
}

async function channelOf(db: Db, conversationId: string): Promise<"imessage" | "app_chat"> {
  const [conv] = await db
    .select({ channel: conversations.channel })
    .from(conversations)
    .where(eq(conversations.id, conversationId));
  return (conv?.channel as "imessage" | "app_chat") ?? "app_chat";
}
