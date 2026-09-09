import { createDb } from "@fambot/database";
import { AppChatChannel, ChannelRouter, ImsgChannel } from "@fambot/messaging";
import { runWorkerOnce } from "./loops";

/**
 * Fambot worker: fires reminders and nags open tasks. No LLM is ever
 * involved here (design doc §21/§37.7) — everything is deterministic
 * schedule math over Postgres with lease-based atomic claims, safe for
 * multiple instances.
 */

const db = createDb(process.env.DATABASE_URL ?? "postgres://postgres:fambot@localhost:5433/fambot");
const router = new ChannelRouter(db, new AppChatChannel(db), new ImsgChannel(db));

const POLL_MS = Number(process.env.WORKER_POLL_MS ?? 5000);

console.log(`[worker] started, polling every ${POLL_MS}ms`);

async function tick() {
  try {
    const { fired, nudged } = await runWorkerOnce(db, router);
    if (fired || nudged) console.log(`[worker] fired ${fired} reminder(s), sent ${nudged} nudge(s)`);
  } catch (err) {
    console.error("[worker] tick failed:", err);
  }
}

setInterval(tick, POLL_MS);
void tick();
