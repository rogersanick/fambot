import { z } from "npm:zod@3.25.76";
import { getSql, jsonResponse } from "../_shared/db.ts";
import { verifyBridge } from "../_shared/bridge-auth.ts";
import type { ChannelRow, HouseholdRow } from "../_shared/agent/types.ts";
import { assembleContext, resolveSender, verifyContextTurns } from "../_shared/agent/context.ts";
import {
  handleLink, handleReactivate, handleSetupFlow, handleStop,
  handleUnknownChannel, parseQuickIntent, stripTags,
} from "../_shared/agent/onboarding.ts";
import { runAgent } from "../_shared/agent/run.ts";
import { enqueueReply, execute } from "../_shared/agent/executor.ts";
import { composeHelp } from "../_shared/agent/composer.ts";

const payloadSchema = z.object({
  message_guid: z.string().min(1),
  chat_guid: z.string().min(1),
  sender_handle: z.string().min(1),
  sender_name: z.string().nullable().optional(),
  message_text: z.string().min(1).max(4000),
  sent_at: z.string(),
  is_from_me: z.boolean().optional(),
  context_turns: z.unknown().optional(),
  chat_participants: z
    .array(z.object({ address: z.string(), displayName: z.string().nullable() }))
    .optional(),
});

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);
  const bridge = await verifyBridge(req);
  if (bridge instanceof Response) return bridge;

  const parsed = payloadSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonResponse({ error: "invalid payload" }, 400);
  const p = parsed.data;

  const sql = getSql();

  // Idempotency level 1: a duplicated webhook or bridge retry is a no-op.
  const inserted = await sql<{ id: string }[]>`
    insert into inbound_messages
      (bridge_id, message_guid, chat_guid, sender_handle, message_text, invoked_bot, processing_state)
    values
      (${bridge.id}, ${p.message_guid}, ${p.chat_guid}, ${p.sender_handle},
       ${p.message_text}, true, 'processing')
    on conflict (bridge_id, message_guid) do nothing
    returning id
  `;
  if (inserted.length === 0) return jsonResponse({ status: "duplicate" });
  const inboundId = inserted[0].id;

  await sql`update bridges set last_inbound_at = now() where id = ${bridge.id}`;

  try {
    await route(sql, bridge.id, inboundId, p);
    await sql`
      update inbound_messages set processing_state = 'done' where id = ${inboundId}
    `;
    return jsonResponse({ status: "ok" });
  } catch (err) {
    console.error(`[ingest] processing failed for ${inboundId}:`, err);
    await sql`
      update inbound_messages
         set processing_state = 'failed', error_code = 'processing_error'
       where id = ${inboundId}
    `.catch(() => {});
    return jsonResponse({ status: "error" }, 500);
  }
});

async function route(
  sql: ReturnType<typeof getSql>,
  bridgeId: string,
  inboundId: string,
  p: z.infer<typeof payloadSchema>,
): Promise<void> {
  // Resolve channel; unknown chats get the onboarding greeting.
  const channels = await sql<ChannelRow[]>`
    select id, household_id, bridge_id, chat_guid, state
      from channels
     where bridge_id = ${bridgeId} and chat_guid = ${p.chat_guid}
  `;
  let channel = channels[0];
  if (!channel) {
    channel = await handleUnknownChannel(sql, bridgeId, p.chat_guid);
    await backfill(sql, inboundId, channel);
    // A bare greeting is enough unless this message already contains setup.
    const stripped = stripTags(p.message_text, "fambot");
    if (parseQuickIntent(stripped)?.kind === "setup") {
      await handleSetupFlow(sql, channel, null, {
        inboundMessageId: inboundId,
        strippedText: stripped,
        senderHandle: p.sender_handle,
        senderName: p.sender_name ?? null,
        participants: p.chat_participants,
      });
    }
    return;
  }

  await backfill(sql, inboundId, channel);

  const household = channel.household_id
    ? (await sql<HouseholdRow[]>`
        select id, slug, display_name, invocation_name, timezone, state,
               quiet_hours_start, quiet_hours_end, morning_default,
               afternoon_default, evening_default, before_event_offset_minutes
          from households where id = ${channel.household_id}
      `)[0] ?? null
    : null;

  const stripped = stripTags(p.message_text, household?.invocation_name ?? "fambot");
  const quick = parseQuickIntent(stripped);

  // Channels without an active household run the setup flow.
  if (!household || household.state === "pending_setup") {
    await handleSetupFlow(sql, channel, household, {
      inboundMessageId: inboundId,
      strippedText: stripped,
      senderHandle: p.sender_handle,
      senderName: p.sender_name ?? null,
      participants: p.chat_participants,
    });
    return;
  }

  // Stopped households: only setup/start reactivates; everything else is silent.
  if (household.state === "stopped") {
    if (quick?.kind === "start" || quick?.kind === "setup") {
      await handleReactivate(sql, channel, household, inboundId);
    }
    return;
  }

  // Active household: deterministic quick intents first, then the agent.
  switch (quick?.kind) {
    case "stop":
      await handleStop(sql, channel, household, inboundId);
      return;
    case "start":
      return; // already active
    case "help": {
      const ctx = await assembleContext(sql, {
        household, channel,
        senderHandle: p.sender_handle, senderName: p.sender_name ?? null,
        inboundMessageId: inboundId, messageText: p.message_text,
        contextTurns: [],
      });
      await enqueueReply(sql, ctx, composeHelp(ctx), "system", `help:${inboundId}`);
      return;
    }
    case "link": {
      const sender = await resolveSender(sql, household.id, p.sender_handle, p.sender_name ?? null);
      await handleLink(sql, channel, household, sender.id, inboundId);
      return;
    }
    case "cancel": {
      const ctx = await assembleContext(sql, {
        household, channel,
        senderHandle: p.sender_handle, senderName: p.sender_name ?? null,
        inboundMessageId: inboundId, messageText: p.message_text,
        contextTurns: [],
      });
      if (ctx.openClarification) {
        await execute(sql, ctx, { type: "cancel_clarification" });
      } else {
        await enqueueReply(sql, ctx, `Nothing to cancel right now.\n${composeHelp(ctx).split("\n").pop()}`, "system", `cancel:${inboundId}`);
      }
      return;
    }
    case "setup":
      return; // already set up; ignore
  }

  // Full agent pipeline. Contextual turns are verified and used only for
  // this inference — never persisted.
  const turns = verifyContextTurns(p.context_turns, p.message_guid, new Date());
  const ctx = await assembleContext(sql, {
    household, channel,
    senderHandle: p.sender_handle, senderName: p.sender_name ?? null,
    inboundMessageId: inboundId, messageText: p.message_text,
    contextTurns: turns,
  });
  await runAgent(sql, ctx);
}

async function backfill(
  sql: ReturnType<typeof getSql>,
  inboundId: string,
  channel: ChannelRow,
): Promise<void> {
  await sql`
    update inbound_messages
       set channel_id = ${channel.id}, household_id = ${channel.household_id}
     where id = ${inboundId}
  `;
}
