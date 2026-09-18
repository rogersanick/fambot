/**
 * Populate .env / .env.prod for every service.
 *
 *   bun run env:setup
 *
 * Copies OpenAI + Telnyx API keys from apps/api/.env, discovers the rest of
 * Telnyx via API, fetches the Neon pooled URL via neonctl, and generates
 * missing secrets. Google OAuth is omitted (email/password only).
 */
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { prodApiUrl } from "./lib/fly-app";
import { keepOrGenerate, readEnvFile, writeEnvFile } from "./lib/env-file";
import { describePostgresUrl, neonConnectionString, resolveNeonProject } from "./lib/neon";
import { discoverTelnyx } from "./lib/telnyx";

const root = resolve(import.meta.dir, "..");

const LOCAL_DATABASE_URL = "postgres://postgres:fambot@localhost:5433/fambot";
const PROD_API_URL = prodApiUrl();
const PROD_APP_URL = "https://fambot-desktop.vercel.app";
const LOCAL_API_URL = "http://localhost:8787";
const LOCAL_APP_URL = "http://localhost:5173";

const PLACEHOLDERS = {
  BETTER_AUTH_SECRET: ["dev-secret-change-me-in-production-0000"],
  BRIDGE_TOKEN: ["dev-bridge-token"],
  TOKEN_ENCRYPTION_KEY: ["dev-encryption-key-change-in-prod!!"],
  MCP_SIGNING_SECRET: ["dev-mcp-signing-secret-change-me-000"],
};

function log(message: string) {
  console.log(`[env] ${message}`);
}

function hexSecret(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}

function tokenEncryptionKey() {
  return randomBytes(16).toString("hex");
}

function existingOrNew(current: string | undefined, generate: () => string) {
  if (current && current.trim()) return current.trim();
  return generate();
}

const paths = {
  api: resolve(root, "apps/api/.env"),
  apiProd: resolve(root, "apps/api/.env.prod"),
  worker: resolve(root, "apps/worker/.env"),
  workerProd: resolve(root, "apps/worker/.env.prod"),
  bridge: resolve(root, "apps/bridge/.env"),
  bridgeProd: resolve(root, "apps/bridge/.env.prod"),
  desktop: resolve(root, "apps/desktop/.env"),
  desktopProd: resolve(root, "apps/desktop/.env.prod"),
  fly: resolve(root, ".env.fly"),
};

async function main() {
  const api = await readEnvFile(paths.api);
  const apiProd = await readEnvFile(paths.apiProd);
  const bridge = await readEnvFile(paths.bridge);
  const bridgeProd = await readEnvFile(paths.bridgeProd);

  const openaiKey = api.OPENAI_API_KEY || apiProd.OPENAI_API_KEY || "";
  const openaiModel = api.OPENAI_MODEL || apiProd.OPENAI_MODEL || "gpt-5-mini";
  const telnyxKey = api.TELNYX_API_KEY || apiProd.TELNYX_API_KEY || "";

  let telnyx = {
    publicKey: api.TELNYX_PUBLIC_KEY || apiProd.TELNYX_PUBLIC_KEY || "",
    fromNumber: api.TELNYX_FROM_NUMBER || apiProd.TELNYX_FROM_NUMBER || "",
    messagingProfileId: api.TELNYX_MESSAGING_PROFILE_ID || apiProd.TELNYX_MESSAGING_PROFILE_ID || "",
  };

  if (telnyxKey) {
    try {
      const discovered = await discoverTelnyx({
        apiKey: telnyxKey,
        fromNumber: telnyx.fromNumber || undefined,
        messagingProfileId: telnyx.messagingProfileId || undefined,
        publicKey: telnyx.publicKey || undefined,
      });
      telnyx = {
        publicKey: discovered.publicKey ?? telnyx.publicKey,
        fromNumber: discovered.fromNumber ?? telnyx.fromNumber,
        messagingProfileId: discovered.messagingProfileId ?? telnyx.messagingProfileId,
      };
      if (telnyx.fromNumber) log(`Telnyx number ${telnyx.fromNumber}`);
      else log("Telnyx key present but no profile-backed number was found");
    } catch (error) {
      log(`Telnyx discovery failed: ${error instanceof Error ? error.message : error}`);
    }
  } else {
    log("TELNYX_API_KEY not set — SMS vars left empty");
  }

  if (!openaiKey) log("OPENAI_API_KEY not set — chat will return 503 until you add one");

  const neon = resolveNeonProject({
    projectId: process.env.NEON_PROJECT_ID,
    project: process.env.NEON_PROJECT,
  });
  const neonPooled = neonConnectionString({ projectId: neon.id, pooled: true });
  log(`Neon project ${neon.name} (${neon.id}) → ${describePostgresUrl(neonPooled)}`);

  const devAuth = keepOrGenerate(api.BETTER_AUTH_SECRET, PLACEHOLDERS.BETTER_AUTH_SECRET, hexSecret);
  const devBridge = keepOrGenerate(api.BRIDGE_TOKEN, PLACEHOLDERS.BRIDGE_TOKEN, hexSecret);
  const devTokenKey = keepOrGenerate(
    api.TOKEN_ENCRYPTION_KEY,
    PLACEHOLDERS.TOKEN_ENCRYPTION_KEY,
    tokenEncryptionKey,
  );
  const devMcp = keepOrGenerate(api.MCP_SIGNING_SECRET, PLACEHOLDERS.MCP_SIGNING_SECRET, hexSecret);

  const prodAuth = existingOrNew(apiProd.BETTER_AUTH_SECRET, hexSecret);
  const prodBridge = existingOrNew(apiProd.BRIDGE_TOKEN, hexSecret);
  const prodTokenKey = existingOrNew(apiProd.TOKEN_ENCRYPTION_KEY, tokenEncryptionKey);
  const prodMcp = existingOrNew(apiProd.MCP_SIGNING_SECRET, hexSecret);

  const apiEntries: Array<[string, string | undefined]> = [
    ["DATABASE_URL", LOCAL_DATABASE_URL],
    ["PORT", "8787"],
    ["API_BASE_URL", LOCAL_API_URL],
    ["APP_URL", LOCAL_APP_URL],
    ["BETTER_AUTH_SECRET", devAuth],
    ["BRIDGE_TOKEN", devBridge],
    ["TOKEN_ENCRYPTION_KEY", devTokenKey],
    ["MCP_SIGNING_SECRET", devMcp],
    ["OPENAI_API_KEY", openaiKey],
    ["OPENAI_MODEL", openaiModel],
    ["TELNYX_API_KEY", telnyxKey],
    ["TELNYX_PUBLIC_KEY", telnyx.publicKey],
    ["TELNYX_MESSAGING_PROFILE_ID", telnyx.messagingProfileId],
    ["TELNYX_FROM_NUMBER", telnyx.fromNumber],
  ];

  const apiProdEntries: Array<[string, string | undefined]> = [
    ["DATABASE_URL", neonPooled],
    ["PORT", "8787"],
    ["API_BASE_URL", PROD_API_URL],
    ["APP_URL", PROD_APP_URL],
    ["BETTER_AUTH_SECRET", prodAuth],
    ["BRIDGE_TOKEN", prodBridge],
    ["TOKEN_ENCRYPTION_KEY", prodTokenKey],
    ["MCP_SIGNING_SECRET", prodMcp],
    ["OPENAI_API_KEY", openaiKey],
    ["OPENAI_MODEL", openaiModel],
    ["TELNYX_API_KEY", telnyxKey],
    ["TELNYX_PUBLIC_KEY", telnyx.publicKey],
    ["TELNYX_MESSAGING_PROFILE_ID", telnyx.messagingProfileId],
    ["TELNYX_FROM_NUMBER", telnyx.fromNumber],
  ];

  const workerEntries: Array<[string, string | undefined]> = [
    ["DATABASE_URL", LOCAL_DATABASE_URL],
    ["TELNYX_API_KEY", telnyxKey],
    ["TELNYX_FROM_NUMBER", telnyx.fromNumber],
    ["TELNYX_MESSAGING_PROFILE_ID", telnyx.messagingProfileId],
    ["WORKER_POLL_MS", "5000"],
  ];

  const workerProdEntries: Array<[string, string | undefined]> = [
    ["DATABASE_URL", neonPooled],
    ["TELNYX_API_KEY", telnyxKey],
    ["TELNYX_FROM_NUMBER", telnyx.fromNumber],
    ["TELNYX_MESSAGING_PROFILE_ID", telnyx.messagingProfileId],
    ["WORKER_POLL_MS", "5000"],
  ];

  writeEnvFile(
    paths.api,
    "# Fambot API — local dev (Docker Postgres). Generated by bun run env:setup.",
    apiEntries,
  );
  writeEnvFile(
    paths.apiProd,
    "# Fambot API — production (Neon + Fly). Generated by bun run env:setup.",
    apiProdEntries,
  );
  writeEnvFile(
    paths.worker,
    "# Fambot worker — local dev. Generated by bun run env:setup.",
    workerEntries,
  );
  writeEnvFile(
    paths.workerProd,
    "# Fambot worker — production. Generated by bun run env:setup.",
    workerProdEntries,
  );
  writeEnvFile(paths.bridge, "# Fambot Mac bridge — local API. Generated by bun run env:setup.", [
    ["API_URL", LOCAL_API_URL],
    ["PROD_API_URL", PROD_API_URL],
    ["BRIDGE_TOKEN", devBridge],
    ["IMSG_BIN", bridge.IMSG_BIN || "imsg"],
    ["BOT_MESSAGE_PREFIX", bridge.BOT_MESSAGE_PREFIX || "Fambot says: 🤖✨"],
    ["STATE_PATH", "./data/state.json"],
    ["FAMBOT_PROFILE", "local-dev"],
  ]);
  writeEnvFile(paths.bridgeProd, "# Fambot Mac bridge — Fly API. Generated by bun run env:setup.", [
    ["API_URL", PROD_API_URL],
    ["PROD_API_URL", PROD_API_URL],
    ["BRIDGE_TOKEN", prodBridge],
    ["IMSG_BIN", bridgeProd.IMSG_BIN || bridge.IMSG_BIN || "imsg"],
    ["BOT_MESSAGE_PREFIX", bridgeProd.BOT_MESSAGE_PREFIX || bridge.BOT_MESSAGE_PREFIX || "Fambot says: 🤖✨"],
    ["STATE_PATH", "./data/state-prod.json"],
    ["FAMBOT_PROFILE", "production"],
  ]);
  writeEnvFile(
    paths.desktop,
    "# Fambot web (Vite). Leave VITE_API_URL unset so /api proxies to localhost:8787.",
    [],
  );
  writeEnvFile(
    paths.desktopProd,
    "# Fambot web — production Vite/Vercel build. Public URL, not a secret.",
    [["VITE_API_URL", PROD_API_URL]],
  );
  writeEnvFile(
    paths.fly,
    "# Fly secrets only. Import with: bun run prod:secrets\n# PORT / API_BASE_URL / APP_URL live in fly.toml [env].",
    [
      ["DATABASE_URL", neonPooled],
      ["OPENAI_API_KEY", openaiKey],
      ["BRIDGE_TOKEN", prodBridge],
      ["BETTER_AUTH_SECRET", prodAuth],
      ["TOKEN_ENCRYPTION_KEY", prodTokenKey],
      ["MCP_SIGNING_SECRET", prodMcp],
      ["TELNYX_API_KEY", telnyxKey],
      ["TELNYX_PUBLIC_KEY", telnyx.publicKey],
      ["TELNYX_MESSAGING_PROFILE_ID", telnyx.messagingProfileId],
      ["TELNYX_FROM_NUMBER", telnyx.fromNumber],
    ],
  );

  log("wrote apps/api/.env and .env.prod");
  log("wrote apps/worker/.env and .env.prod");
  log("wrote apps/bridge/.env and .env.prod");
  log("wrote apps/desktop/.env and .env.prod");
  log("wrote .env.fly");
}

main().catch((error) => {
  console.error(`[env] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
