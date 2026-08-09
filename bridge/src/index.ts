import { loadConfig } from "./config.js";
import { Spool } from "./spool.js";
import { ContextBuffer } from "./context-buffer.js";
import { InvocationMatcher } from "./invocation.js";
import { ImsgRpc } from "./imsg-rpc.js";
import { FambotApi } from "./fambot-api.js";
import { createInboundHandler } from "./inbound.js";
import { Forwarder } from "./forwarder.js";
import { OutboxPoller } from "./outbox-poller.js";
import { Heartbeat } from "./heartbeat.js";

const config = loadConfig();
const spool = new Spool(config.spoolPath);
const contextBuffer = new ContextBuffer();
const matcher = new InvocationMatcher();
const api = new FambotApi(config.functionsUrl, config.bridgeId, config.bridgeSecret);

const rpc = new ImsgRpc({
  bin: config.imsgBin,
  onMessage: (message) => handleInbound(message),
  getCursor: () => spool.getWatchCursor(),
  setCursor: (rowid) => spool.setWatchCursor(rowid),
});

const poller = new OutboxPoller(config, api, rpc, spool);
const forwarder = new Forwarder(spool, api, () => poller.burst());
const heartbeat = new Heartbeat(config, api, matcher, spool);

const handleInbound = createInboundHandler({
  config,
  spool,
  contextBuffer,
  matcher,
  rpc,
  onInvocationSpooled: () => forwarder.kick(),
});

const sweepTimer = setInterval(() => contextBuffer.sweep(), 60_000);

async function main(): Promise<void> {
  console.log(`FamBot bridge (${config.profile}) starting`);
  console.log(`  imsg binary: ${config.imsgBin}`);
  console.log(`  Edge functions: ${config.functionsUrl}`);
  if (config.profile === "local-dev") {
    console.log(`  Chat allowlist: ${config.chatAllowlist.size} chat(s)`);
    console.log(`  Bot prefix: ${config.botMessagePrefix}`);
  }

  await rpc.start();

  // Readiness probe: proves chat.db is readable (Full Disk Access granted).
  try {
    const chats = await rpc.chatsList(1);
    console.log(`  imsg ready — ${chats.length > 0 ? "chat.db readable" : "no chats visible yet"}`);
  } catch (err) {
    console.error(
      "[startup] imsg is running but chats.list failed — check Full Disk Access:",
      err instanceof Error ? err.message : err,
    );
  }

  forwarder.start();
  poller.start();
  heartbeat.start();
  console.log("FamBot bridge is watching for messages.");
}

function shutdown(): void {
  console.log("\nShutting down…");
  forwarder.stop();
  poller.stop();
  heartbeat.stop();
  clearInterval(sweepTimer);
  rpc.stop();
  setTimeout(() => process.exit(0), 500).unref();
  process.exitCode = 0;
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch((err) => {
  console.error("[startup] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
