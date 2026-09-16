import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";
import { AIUnavailableError } from "@fambot/ai";
import { auth } from "./auth";
import { api, oauthCallback } from "./routes";
import { ingest } from "./ingest";
import { bridgeLogin } from "./bridge-login";
import { mcpApp } from "./mcp";
import { bridgeConnected, bridgeDisconnected, bridgeMessage } from "./bridge-ws";
import { db } from "./context";
import { processInbound } from "./pipeline";
import {
  checkTelnyxInboundHealth,
  drainTelnyxEvents,
  enqueueTelnyxEvent,
  verifyTelnyxSignature,
} from "./telnyx";
import { env, telnyxEnabled } from "./env";
import { isAllowedOrigin } from "./origins";
import { publicArtifacts } from "./public-artifacts";

const { upgradeWebSocket, websocket } = createBunWebSocket<ServerWebSocket>();

const app = new Hono();

app.use("*", logger());
app.onError((error, c) => {
  if (error instanceof AIUnavailableError) {
    return c.json(
      {
        error: "AI_NOT_CONFIGURED",
        message: "Set OPENAI_API_KEY in apps/api/.env to use chat interpretation.",
      },
      503
    );
  }
  console.error(error);
  return c.json({ error: "internal_server_error" }, 500);
});
app.use(
  "*",
  cors({
    origin: (origin) => (isAllowedOrigin(origin, env.APP_URL) ? origin : null),
    credentials: true,
  })
);

app.get("/health", (c) => c.json({ ok: true, service: "fambot-api" }));

// Public artifact previews (no session — iMessage/SMS unfurl + login card)
app.route("/", publicArtifacts);

// Public client config (pre-auth): which sign-in methods exist.
app.get("/api/config", async (c) => {
  const { googleEnabled } = await import("./env");
  return c.json({
    googleAuth: googleEnabled,
    aiConfigured: Boolean(env.OPENAI_API_KEY),
  });
});

// Better Auth (sign-in/up, Google OAuth, sessions)
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Google Calendar OAuth callback (no session — browser redirect from Google)
app.route("/", oauthCallback);

// Bridge inbound webhook (token auth) + interactive owner login
app.route("/", ingest);
app.route("/", bridgeLogin);

// MCP tool surface (delegated bearer-token auth; used by the built-in agent
// over loopback today, external agents later)
app.route("/", mcpApp);

// Telnyx webhooks (signature auth, no session). Verify → enqueue (deduped on
// event id) → ack immediately; a background drain does the real work so we
// always answer inside Telnyx's two-second window.
let telnyxDraining = false;
async function drainTelnyx() {
  if (telnyxDraining) return;
  telnyxDraining = true;
  try {
    await drainTelnyxEvents(db, { processInbound });
  } finally {
    telnyxDraining = false;
  }
}

app.post("/api/webhooks/telnyx", async (c) => {
  if (!env.TELNYX_PUBLIC_KEY) {
    console.warn("[telnyx] webhook rejected: TELNYX_PUBLIC_KEY is not set");
    return c.json({ error: "telnyx_not_configured" }, 503);
  }
  const rawBody = await c.req.text();
  const valid = verifyTelnyxSignature({
    publicKeyBase64: env.TELNYX_PUBLIC_KEY,
    signatureBase64: c.req.header("telnyx-signature-ed25519"),
    timestamp: c.req.header("telnyx-timestamp"),
    rawBody,
  });
  if (!valid) {
    console.warn("[telnyx] webhook rejected: invalid signature");
    return c.json({ error: "invalid_signature" }, 400);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.warn("[telnyx] webhook rejected: invalid JSON");
    return c.json({ error: "invalid_json" }, 400);
  }
  const eventType =
    payload && typeof payload === "object" && "data" in payload
      ? (payload as { data?: { event_type?: string } }).data?.event_type
      : undefined;
  console.log(`[telnyx] webhook accepted${eventType ? ` (${eventType})` : ""}`);
  await enqueueTelnyxEvent(db, payload as Parameters<typeof enqueueTelnyxEvent>[1]);
  queueMicrotask(() => void drainTelnyx());
  return c.json({ received: true });
});

if (telnyxEnabled) {
  setInterval(() => void drainTelnyx(), 5_000);
}

if (telnyxEnabled && env.TELNYX_API_KEY && env.API_BASE_URL.includes("localhost")) {
  const seenInboundWarnings = new Set<string>();
  const pollInboundHealth = async () => {
    try {
      for (const warning of await checkTelnyxInboundHealth({ apiKey: env.TELNYX_API_KEY! })) {
        if (seenInboundWarnings.has(warning)) continue;
        seenInboundWarnings.add(warning);
        console.warn(`[telnyx] ${warning}`);
      }
    } catch (error) {
      console.warn(
        `[telnyx] inbound health check failed: ${error instanceof Error ? error.message : error}`
      );
    }
  };
  void pollInboundHealth();
  setInterval(() => void pollInboundHealth(), 30_000);
}

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

console.log(
  `[api] listening on :${env.PORT} (${
    env.OPENAI_API_KEY ? `model: ${env.OPENAI_MODEL ?? "gpt-5-mini"}` : "AI interpretation disabled"
  }, ${telnyxEnabled ? `SMS via Telnyx from ${env.TELNYX_FROM_NUMBER}` : "SMS disabled — set TELNYX_* vars"})`
);

export default {
  port: env.PORT,
  fetch: app.fetch,
  websocket,
};
