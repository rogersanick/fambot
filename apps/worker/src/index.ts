import { createDb } from "@fambot/database";
import { ApnsClient, NotificationDispatcher, TelnyxSmsChannel } from "@fambot/messaging";
import { runWorkerOnce } from "./loops";

/**
 * Fambot worker: fires reminders and nags open tasks. No LLM is ever
 * involved here (design doc §21/§37.7) — everything is deterministic
 * schedule math over Postgres with lease-based atomic claims, safe for
 * multiple instances. Scheduled notifications broadcast to the household's
 * enabled channels (SMS default, iMessage opt-in); web chat is never used.
 */

const db = createDb(process.env.DATABASE_URL ?? "postgres://postgres:fambot@localhost:5433/fambot");

const telnyxConfigured = Boolean(process.env.TELNYX_API_KEY && process.env.TELNYX_FROM_NUMBER);
const telnyx = telnyxConfigured
  ? new TelnyxSmsChannel(db, {
      apiKey: process.env.TELNYX_API_KEY!,
      fromNumber: process.env.TELNYX_FROM_NUMBER!,
      messagingProfileId: process.env.TELNYX_MESSAGING_PROFILE_ID,
    })
  : null;
// APNs (native app push). Sandbox vs production is chosen per device row at
// send time — dev-signed installs are sandbox even against the prod API.
const apnsConfigured = Boolean(
  process.env.APNS_TEAM_ID &&
    process.env.APNS_KEY_ID &&
    process.env.APNS_BUNDLE_ID &&
    process.env.APNS_PRIVATE_KEY
);
const apns = apnsConfigured
  ? new ApnsClient({
      teamId: process.env.APNS_TEAM_ID!,
      keyId: process.env.APNS_KEY_ID!,
      bundleId: process.env.APNS_BUNDLE_ID!,
      privateKey: process.env.APNS_PRIVATE_KEY!,
    })
  : null;

// iMessage outbox rows are flushed by the API's bridge websocket sweeper
// (every 15s), so no notify hook is needed here.
const dispatcher = new NotificationDispatcher(db, { telnyx, apns });

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5000);

console.log(
  `[worker] started, polling every ${POLL_MS}ms (${
    telnyxConfigured ? `SMS via Telnyx from ${process.env.TELNYX_FROM_NUMBER}` : "SMS disabled — set TELNYX_* vars"
  }, ${apnsConfigured ? `push via APNs topic ${process.env.APNS_BUNDLE_ID}` : "push disabled — set APNS_* vars"})`
);

async function tick() {
  try {
    const { fired, spawned } = await runWorkerOnce(db, dispatcher);
    if (fired || spawned)
      console.log(`[worker] fired ${fired} reminder(s), spawned ${spawned} occurrence(s)`);
  } catch (err) {
    console.error("[worker] tick failed:", err);
  }
}

setInterval(tick, POLL_MS);
void tick();
