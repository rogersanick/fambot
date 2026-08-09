import type { Sql } from "../db.ts";
import type { ChannelRow, HouseholdRow } from "./types.ts";
import { isValidIanaTimezone } from "./time.ts";
import { links } from "./deeplink.ts";

/** Strip every invocation tag (fambot + the custom name) from the message. */
export function stripTags(text: string, invocationName: string): string {
  const names = ["fambot", invocationName.toLowerCase()];
  let out = text;
  for (const name of new Set(names)) {
    out = out.replace(new RegExp(`@?${name}\\b[,:]?`, "gi"), " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

export type QuickIntent =
  | { kind: "setup"; name: string }
  | { kind: "start" }
  | { kind: "stop" }
  | { kind: "help" }
  | { kind: "link" }
  | { kind: "cancel" }
  | null;

/** Deterministic intents handled before (and without) the LLM. */
export function parseQuickIntent(strippedText: string): QuickIntent {
  const t = strippedText.trim();
  const setup = t.match(/^set\s*up\s+(.+)$/i);
  if (setup) return { kind: "setup", name: setup[1].trim().slice(0, 80) };
  if (/^start$/i.test(t)) return { kind: "start" };
  if (/^stop$/i.test(t)) return { kind: "stop" };
  if (/^help$/i.test(t)) return { kind: "help" };
  if (/^link( me)?$/i.test(t)) return { kind: "link" };
  if (/^(cancel|never\s*mind|nevermind)$/i.test(t)) return { kind: "cancel" };
  return null;
}

interface OutboxTarget {
  bridgeId: string;
  channelId: string;
  householdId: string | null;
  chatGuid: string;
}

async function enqueue(
  sql: Sql,
  target: OutboxTarget,
  messageType: "onboarding" | "system" | "confirmation",
  text: string,
  dedupeKey: string,
): Promise<void> {
  await sql`
    insert into outbox
      (bridge_id, channel_id, household_id, chat_guid, message_type, message_text, dedupe_key)
    values
      (${target.bridgeId}, ${target.channelId}, ${target.householdId},
       ${target.chatGuid}, ${messageType}, ${text}, ${dedupeKey})
    on conflict (dedupe_key) do nothing
  `;
}

function target(channel: ChannelRow): OutboxTarget {
  return {
    bridgeId: channel.bridge_id,
    channelId: channel.id,
    householdId: channel.household_id,
    chatGuid: channel.chat_guid,
  };
}

/** Unknown chat GUID tagged the bot: create the channel and greet once. */
export async function handleUnknownChannel(
  sql: Sql,
  bridgeId: string,
  chatGuid: string,
): Promise<ChannelRow> {
  const rows = await sql<ChannelRow[]>`
    insert into channels (bridge_id, chat_guid)
    values (${bridgeId}, ${chatGuid})
    on conflict (bridge_id, chat_guid) do update set chat_guid = excluded.chat_guid
    returning id, household_id, bridge_id, chat_guid, state
  `;
  const channel = rows[0];
  await enqueue(
    sql,
    target(channel),
    "onboarding",
    [
      `Hi, I'm FamBot — I help this group track shared tasks and events.`,
      `To get started, reply: @fambot setup <your household name>`,
      links.help(),
    ].join("\n"),
    `onboarding:${channel.id}`,
  );
  return channel;
}

/**
 * Setup flow for channels whose household isn't active yet:
 * 1. `@fambot setup <name>` creates the household and seeds members
 * 2. a valid IANA timezone activates it
 */
export async function handleSetupFlow(
  sql: Sql,
  channel: ChannelRow,
  household: HouseholdRow | null,
  args: {
    inboundMessageId: string;
    strippedText: string;
    senderHandle: string;
    senderName: string | null;
    participants?: { address: string; displayName: string | null }[];
  },
): Promise<void> {
  const quick = parseQuickIntent(args.strippedText);

  if (!household) {
    if (quick?.kind === "setup") {
      await sql.begin(async (tx) => {
        const rows = await tx<HouseholdRow[]>`
          insert into households (display_name)
          values (${quick.name})
          returning id, slug, display_name, invocation_name, timezone, state,
                    quiet_hours_start, quiet_hours_end, morning_default,
                    afternoon_default, evening_default, before_event_offset_minutes
        `;
        const h = rows[0];
        await tx`update channels set household_id = ${h.id} where id = ${channel.id}`;
        await seedMembers(tx, h.id, args);
        await enqueue(
          tx,
          { ...target(channel), householdId: h.id },
          "onboarding",
          `Nice to meet you, ${quick.name}! What timezone should I use? e.g. @fambot America/New_York\n${links.help()}`,
          `setup-tz:${channel.id}`,
        );
      });
      return;
    }
    // Not a setup command — nudge (idempotent per inbound message).
    await enqueue(
      sql,
      target(channel),
      "onboarding",
      `To get started, reply: @fambot setup <your household name>\n${links.help()}`,
      `setup-nudge:${args.inboundMessageId}`,
    );
    return;
  }

  // Household exists but is pending timezone.
  const tzCandidate = args.strippedText.trim().replace(/\s+/g, "_");
  if (tzCandidate.includes("/") && isValidIanaTimezone(tzCandidate)) {
    await sql.begin(async (tx) => {
      await tx`
        update households
           set timezone = ${tzCandidate}, state = 'active', activated_at = now()
         where id = ${household.id}
      `;
      await tx`update channels set state = 'active' where id = ${channel.id}`;
      await seedMembers(tx, household.id, args);
      await enqueue(
        tx,
        target(channel),
        "onboarding",
        [
          `You're all set! Tag @fambot in plain language to add tasks and events.`,
          `Tip: you can rename me anytime — try "@fambot call yourself Jerry".`,
          links.dashboard(household.slug),
        ].join("\n"),
        `setup-done:${household.id}`,
      );
    });
    return;
  }

  if (quick?.kind === "setup") {
    // Re-running setup while pending just updates the name.
    await sql`update households set display_name = ${quick.name} where id = ${household.id}`;
  }

  await enqueue(
    sql,
    target(channel),
    "onboarding",
    `What timezone should I use? e.g. @fambot America/New_York\n${links.help()}`,
    `setup-tz-nudge:${args.inboundMessageId}`,
  );
}

async function seedMembers(
  tx: Sql,
  householdId: string,
  args: {
    senderHandle: string;
    senderName: string | null;
    participants?: { address: string; displayName: string | null }[];
  },
): Promise<void> {
  const roster = new Map<string, string | null>();
  for (const p of args.participants ?? []) {
    if (p.address) roster.set(p.address, p.displayName);
  }
  roster.set(args.senderHandle, args.senderName ?? roster.get(args.senderHandle) ?? null);

  for (const [handle, name] of roster) {
    await tx`
      insert into members (household_id, normalized_handle, display_name, last_seen_at)
      values (${householdId}, ${handle}, ${name}, now())
      on conflict (household_id, normalized_handle)
        do update set display_name = coalesce(members.display_name, excluded.display_name)
    `;
  }
}

/** `@fambot stop`: honored immediately, confirmed once, never re-engaged. */
export async function handleStop(
  sql: Sql,
  channel: ChannelRow,
  household: HouseholdRow,
  inboundMessageId: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      update households set state = 'stopped', stopped_at = now()
       where id = ${household.id}
    `;
    await tx`update channels set state = 'stopped' where household_id = ${household.id}`;
    await tx`
      update outbox set state = 'suppressed'
       where household_id = ${household.id}
         and state in ('pending', 'retry', 'leased')
    `;
    await enqueue(
      tx,
      target(channel),
      "system",
      `Understood — I've stopped. Reminders are off and I won't reply here. Text "@fambot start" to bring me back.\n${links.help()}`,
      `stop:${inboundMessageId}`,
    );
  });
}

export async function handleReactivate(
  sql: Sql,
  channel: ChannelRow,
  household: HouseholdRow,
  inboundMessageId: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`
      update households set state = 'active', stopped_at = null
       where id = ${household.id}
    `;
    await tx`update channels set state = 'active' where household_id = ${household.id}`;
    await enqueue(
      tx,
      target(channel),
      "system",
      `I'm back! Tag @${household.invocation_name} whenever you need me.\n${links.dashboard(household.slug)}`,
      `start:${inboundMessageId}`,
    );
  });
}

/** `@fambot link`: mint a one-time portal linking code for the sender. */
export async function handleLink(
  sql: Sql,
  channel: ChannelRow,
  household: HouseholdRow,
  senderMemberId: string,
  inboundMessageId: string,
): Promise<void> {
  const code = Array.from(crypto.getRandomValues(new Uint8Array(6)))
    .map((b) => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31])
    .join("");
  await sql.begin(async (tx) => {
    await tx`
      insert into link_codes (code, member_id, household_id, expires_at)
      values (${code}, ${senderMemberId}, ${household.id}, now() + interval '1 hour')
    `;
    await enqueue(
      tx,
      target(channel),
      "system",
      `Your one-time code: ${code} (valid 1 hour). Enter it after signing in:\n${links.linkEntry()}`,
      `link:${inboundMessageId}`,
    );
  });
}
