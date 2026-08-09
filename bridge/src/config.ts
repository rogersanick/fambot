import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const envSchema = z.object({
  FAMBOT_PROFILE: z.enum(["local-dev", "production"]).default("local-dev"),
  IMSG_BIN: z.string().min(1).default("imsg"),
  SUPABASE_FUNCTIONS_URL: z.string().url().default("http://127.0.0.1:54321/functions/v1"),
  BRIDGE_ID: z.string().uuid(),
  BRIDGE_SECRET: z.string().min(1),
  CHAT_ALLOWLIST: z.string().default(""),
  BOT_MESSAGE_PREFIX: z.string().default("Fambot says: 🤖✨"),
  SPOOL_PATH: z.string().default("./data/spool.sqlite"),
});

/** Minimal .env loader so the worker has zero runtime deps beyond sqlite/zod. */
function loadDotEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(here, "..", ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

export interface BridgeConfig {
  profile: "local-dev" | "production";
  /** Path or PATH-resolved name of the imsg binary (spawned as `imsg rpc`). */
  imsgBin: string;
  functionsUrl: string;
  bridgeId: string;
  bridgeSecret: string;
  /** local-dev: only these chat GUIDs are ever processed. Empty in production. */
  chatAllowlist: Set<string>;
  botMessagePrefix: string;
  spoolPath: string;
  workerVersion: string;
}

export function loadConfig(): BridgeConfig {
  loadDotEnv();
  const env = envSchema.parse(process.env);

  const allowlist = new Set(
    env.CHAT_ALLOWLIST.split(",").map((s) => s.trim()).filter(Boolean),
  );

  if (env.FAMBOT_PROFILE === "local-dev" && allowlist.size === 0) {
    console.warn(
      "[config] CHAT_ALLOWLIST is empty — in local-dev the bridge processes nothing until you allowlist a chat GUID.",
    );
  }

  return {
    profile: env.FAMBOT_PROFILE,
    imsgBin: env.IMSG_BIN,
    functionsUrl: env.SUPABASE_FUNCTIONS_URL.replace(/\/$/, ""),
    bridgeId: env.BRIDGE_ID,
    bridgeSecret: env.BRIDGE_SECRET,
    chatAllowlist: allowlist,
    botMessagePrefix: env.BOT_MESSAGE_PREFIX,
    spoolPath: env.SPOOL_PATH,
    workerVersion: "0.1.0",
  };
}
