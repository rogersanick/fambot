import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";
import { auth } from "./auth";
import { api, oauthCallback } from "./routes";
import { ingest } from "./ingest";
import { bridgeConnected, bridgeDisconnected, bridgeMessage } from "./bridge-ws";
import { env } from "./env";

const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: [env.APP_URL, "http://localhost:5173", "http://localhost:1420", "tauri://localhost"],
    credentials: true,
  })
);

app.get("/health", (c) => c.json({ ok: true, service: "fambot-api" }));

// Public client config (pre-auth): which sign-in methods exist.
app.get("/api/config", async (c) => {
  const { googleEnabled } = await import("./env");
  return c.json({ googleAuth: googleEnabled });
});

// Better Auth (sign-in/up, Google OAuth, sessions)
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Google Calendar OAuth callback (no session — browser redirect from Google)
app.route("/", oauthCallback);

// Bridge inbound webhook (token auth)
app.route("/", ingest);

// Bridge outbound WebSocket (token auth via query param)
app.get(
  "/api/bridge/ws",
  upgradeWebSocket((c) => {
    const token = c.req.query("token");
    const authorized = token === env.BRIDGE_TOKEN;
    let wrapper: { send(data: string): void } | null = null;
    return {
      onOpen(_evt, ws) {
        if (!authorized) {
          ws.close(4401, "unauthorized");
          return;
        }
        console.log("[bridge] connected");
        wrapper = { send: (data) => ws.send(data) };
        bridgeConnected(wrapper);
      },
      onMessage(evt) {
        if (!authorized) return;
        void bridgeMessage(evt.data as string);
      },
      onClose() {
        console.log("[bridge] disconnected");
        if (wrapper) bridgeDisconnected(wrapper);
      },
    };
  })
);

// Session-protected application API
app.route("/api", api);

console.log(`[api] listening on :${env.PORT} (model: ${env.OPENAI_MODEL ?? "gpt-5-mini"})`);

export default {
  port: env.PORT,
  fetch: app.fetch,
  websocket,
};
