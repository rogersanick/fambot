import { prepareRuntime } from "./cli";
import { ImsgRpc } from "./imsg-rpc";
import { BridgeState } from "./state";
import { InboundRelay, OutboundConsumer } from "./relay";

/**
 * Fambot Mac bridge — a pure iMessage relay. The ONLY thing that runs on the
 * Mac. Inbound messages are forwarded to the cloud API; outbound sends arrive
 * over a WebSocket and go out through the imsg CLI. No inference, no
 * database, no business logic.
 *
 * `bun dev` starts this with BRIDGE_TOKEN from env. `bun bridge:local` /
 * `bun bridge:prod` prompt for a household-owner login and point at that API.
 */

const config = await prepareRuntime(process.argv.slice(2))
  .then((runtime) => runtime.config)
  .catch((err) => {
    console.error(`[bridge] ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  });
if (!config) process.exit(1);
const state = new BridgeState(config.STATE_PATH);
const relay = new InboundRelay(config, state);

const rpc = new ImsgRpc({
  bin: config.IMSG_BIN,
  onMessage: (msg) => relay.handle(msg),
  getCursor: () => state.getCursor(),
  setCursor: (rowid) => state.setCursor(rowid),
});

const outbound = new OutboundConsumer(config, state, (args) => rpc.send(args));

console.log(`[bridge] starting (api=${config.API_URL})`);

await rpc.start().catch((err) => {
  console.error(`[bridge] failed to start: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
outbound.start();

process.on("SIGINT", () => {
  console.log("[bridge] shutting down");
  outbound.stop();
  rpc.stop();
  process.exit(0);
});
