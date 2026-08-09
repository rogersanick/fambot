import { z } from "zod";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const envSchema = z.object({
  FAMBOT_PROFILE: z.enum(["local-dev", "production"]).default("local-dev"),
  IMSG_BIN: z.string().min(1).default("imsg"),
  CHAT_ALLOWLIST: z.string().default(""),
  BOT_NAME: z.string().min(1).default("fambot"),
  BOT_MESSAGE_PREFIX: z.string().default("Fambot says: 🤖✨"),
  STATE_PATH: z.string().default("./data/state.json"),

  // Supabase — the bridge signs in as the agent user (RLS applies to it).
  SUPABASE_URL: z.string().url().default("http://127.0.0.1:54321"),
  SUPABASE_ANON_KEY: z.string().min(1),
  AGENT_EMAIL: z.string().default("agent@fambot.local"),
  AGENT_PASSWORD: z.string().default("fambot-agent"),

  // FamBot MCP server (the Next.js app).
  MCP_URL: z.string().url().default("http://localhost:3000/mcp"),

  // Agent adapter. "cli" shells out to AGENT_CMD (prompt on stdin, reply on
  // stdout, FAMBOT_MCP_URL/FAMBOT_MCP_TOKEN in env). "openai" drives a
  // tool-calling loop against an OpenAI-compatible endpoint.
  AGENT_MODE: z.enum(["cli", "openai"]).default("openai"),
  AGENT_CMD: z.string().default(""),
  AGENT_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  OPENAI_BASE_URL: z.string().url().default("http://127.0.0.1:1337/v1"),
  OPENAI_MODEL: z.string().default(""),
  OPENAI_API_KEY: z.string().default(""),

  REMINDER_POLL_MS: z.coerce.number().int().positive().default(30_000),
});

/** Minimal .env loader so the worker has no dotenv dependency. */
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
  imsgBin: string;
  /** local-dev: only these chat GUIDs are ever processed. */
  chatAllowlist: Set<string>;
  botName: string;
  botMessagePrefix: string;
  statePath: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  agentEmail: string;
  agentPassword: string;
  mcpUrl: string;
  agentMode: "cli" | "openai";
  agentCmd: string;
  agentTimeoutMs: number;
  openaiBaseUrl: string;
  openaiModel: string;
  openaiApiKey: string;
  reminderPollMs: number;
}

export function loadConfig(): BridgeConfig {
  loadDotEnv();
  const env = envSchema.parse(process.env);

  const allowlist = new Set(env.CHAT_ALLOWLIST.split(",").map((s) => s.trim()).filter(Boolean));
  if (env.FAMBOT_PROFILE === "local-dev" && allowlist.size === 0) {
    console.warn(
      "[config] CHAT_ALLOWLIST is empty — in local-dev the bridge processes nothing until you allowlist a chat GUID.",
    );
  }
  if (env.AGENT_MODE === "cli" && !env.AGENT_CMD) {
    throw new Error("AGENT_MODE=cli requires AGENT_CMD (e.g. `claude -p --dangerously-skip-permissions`)");
  }
  if (env.AGENT_MODE === "openai" && !env.OPENAI_MODEL) {
    throw new Error("AGENT_MODE=openai requires OPENAI_MODEL (a model id served by OPENAI_BASE_URL)");
  }

  return {
    profile: env.FAMBOT_PROFILE,
    imsgBin: env.IMSG_BIN,
    chatAllowlist: allowlist,
    botName: env.BOT_NAME.toLowerCase(),
    botMessagePrefix: env.BOT_MESSAGE_PREFIX,
    statePath: env.STATE_PATH,
    supabaseUrl: env.SUPABASE_URL.replace(/\/$/, ""),
    supabaseAnonKey: env.SUPABASE_ANON_KEY,
    agentEmail: env.AGENT_EMAIL,
    agentPassword: env.AGENT_PASSWORD,
    mcpUrl: env.MCP_URL,
    agentMode: env.AGENT_MODE,
    agentCmd: env.AGENT_CMD,
    agentTimeoutMs: env.AGENT_TIMEOUT_MS,
    openaiBaseUrl: env.OPENAI_BASE_URL.replace(/\/$/, ""),
    openaiModel: env.OPENAI_MODEL,
    openaiApiKey: env.OPENAI_API_KEY,
    reminderPollMs: env.REMINDER_POLL_MS,
  };
}
