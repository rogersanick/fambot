import { loadConfig } from "./config";
import { ImsgRpc } from "./imsg-rpc";
import { BridgeState } from "./state";
import { InboundRelay, OutboundConsumer } from "./relay";

/**
 * Fambot Mac bridge — a pure iMessage relay. The ONLY thing that runs on the
 * Mac. Inbound messages are forwarded to the cloud API; outbound sends arrive
 * over a WebSocket and go out through the imsg CLI. No inference, no
 * database, no business logic.
 */

const config = loadConfig();
const state = new BridgeState(config.STATE_PATH);
const relay = new InboundRelay(config, state);

const rpc = new ImsgRpc({
  bin: config.IMSG_BIN,
  onMessage: (msg) => relay.handle(msg),
  getCursor: () => state.getCursor(),
  setCursor: (rowid) => state.setCursor(rowid),
});

const outbound = new OutboundConsumer(config, state, (args) => rpc.send(args));

console.log(`[bridge] starting (profile=${config.FAMBOT_PROFILE}, api=${config.API_URL})`);

await rpc.start();
outbound.start();

process.on("SIGINT", () => {
  console.log("[bridge] shutting down");
  outbound.stop();
  rpc.stop();
  process.exit(0);
});
