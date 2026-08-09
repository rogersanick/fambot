import type { Sql } from "../db.ts";
import type {
  AgentContext, ChannelRow, ClarificationRow, ContextTurn, EventRow,
  HouseholdRow, MemberRow, TaskRow,
} from "./types.ts";

const MAX_CONTEXT_TURNS = 8;
const MAX_CONTEXT_AGE_MS = 10 * 60 * 1000;

/**
 * Verify the bridge-supplied context window: same chat, text-only (already
 * guaranteed by shape), bounded to 8 turns / 10 minutes, and ending with the
 * invoking message. Turns are used only for this inference request — they are
 * never written to inbound_messages, bot_runs, logs, or audit records.
 */
export function verifyContextTurns(
  turns: unknown,
  invokingGuid: string,
  now: Date,
): ContextTurn[] {
  if (!Array.isArray(turns)) return [];
  const cleaned: ContextTurn[] = [];
  for (const t of turns.slice(-MAX_CONTEXT_TURNS)) {
    if (typeof t !== "object" || t === null) continue;
    const turn = t as Record<string, unknown>;
    if (typeof turn.messageGuid !== "string" || typeof turn.text !== "string") continue;
    if (typeof turn.sentAt !== "string") continue;
    const age = now.getTime() - Date.parse(turn.sentAt);
    if (!(age >= -60_000 && age <= MAX_CONTEXT_AGE_MS)) continue;
    cleaned.push({
      messageGuid: turn.messageGuid,
      senderHandle: String(turn.senderHandle ?? "unknown"),
      senderName: typeof turn.senderName === "string" ? turn.senderName : null,
      text: turn.text.slice(0, 2000),
      sentAt: turn.sentAt,
      invokedBot: Boolean(turn.invokedBot),
      isFromMe: Boolean(turn.isFromMe),
    });
  }
  if (cleaned.length === 0 || cleaned[cleaned.length - 1].messageGuid !== invokingGuid) {
    // Context must end with the invoking message; otherwise use none.
    return cleaned.filter((t) => t.messageGuid === invokingGuid);
  }
  return cleaned;
}

/** Resolve or create the sender's member row (roster refresh on the fly). */
export async function resolveSender(
  sql: Sql,
  householdId: string,
  senderHandle: string,
  senderName: string | null,
): Promise<MemberRow> {
  const rows = await sql<MemberRow[]>`
    insert into members (household_id, normalized_handle, display_name, last_seen_at)
    values (${householdId}, ${senderHandle}, ${senderName}, now())
    on conflict (household_id, normalized_handle)
      do update set last_seen_at = now(),
                    display_name = coalesce(members.display_name, excluded.display_name)
    returning id, normalized_handle, display_name, aliases, removed_at
  `;
  return rows[0];
}

export async function assembleContext(
  sql: Sql,
  args: {
    household: HouseholdRow;
    channel: ChannelRow;
    senderHandle: string;
    senderName: string | null;
    inboundMessageId: string;
    messageText: string;
    contextTurns: ContextTurn[];
  },
): Promise<AgentContext> {
  const { household, channel } = args;

  const sender = await resolveSender(sql, household.id, args.senderHandle, args.senderName);

  const members = await sql<MemberRow[]>`
    select id, normalized_handle, display_name, aliases, removed_at
      from members
     where household_id = ${household.id} and removed_at is null
     order by joined_at
  `;

  const openTasks = await sql<TaskRow[]>`
    select id, short_code, title, status, assignee_member_id, due_at
      from tasks
     where household_id = ${household.id} and status = 'open'
     order by due_at nulls last, created_at
     limit 50
  `;

  const upcomingEvents = await sql<EventRow[]>`
    select id, short_code, title, starts_at, ends_at, location
      from events
     where household_id = ${household.id}
       and status = 'active'
       and starts_at < now() + interval '14 days'
       and coalesce(ends_at, starts_at) > now() - interval '1 day'
     order by starts_at
     limit 50
  `;

  const clarifications = await sql<ClarificationRow[]>`
    select id, requester_member_id, draft_action, missing_field, question_text
      from pending_clarifications
     where household_id = ${household.id} and state = 'open' and expires_at > now()
     limit 1
  `;

  const recentBot = await sql<{ message_text: string }[]>`
    select message_text
      from outbox
     where channel_id = ${channel.id} and state = 'sent'
     order by sent_at desc
     limit 3
  `;

  return {
    household,
    channel,
    sender,
    members,
    openTasks,
    upcomingEvents,
    openClarification: clarifications[0] ?? null,
    recentBotMessages: recentBot.map((r) => r.message_text).reverse(),
    contextTurns: args.contextTurns,
    inboundMessageId: args.inboundMessageId,
    messageText: args.messageText,
    now: new Date(),
  };
}
