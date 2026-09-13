import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().default("postgres://postgres:fambot@localhost:5433/fambot"),
  PORT: z.coerce.number().default(8787),
  /** Public URL of this API (OAuth callbacks). */
  API_BASE_URL: z.string().default("http://localhost:8787"),
  /** Where the SPA lives (redirects after OAuth). */
  APP_URL: z.string().default("http://localhost:5173"),
  BETTER_AUTH_SECRET: z.string().default("dev-secret-change-me-in-production-0000"),
  BRIDGE_TOKEN: z.string().default("dev-bridge-token"),
  /** Signs short-lived delegated tokens for the /mcp endpoint. */
  MCP_SIGNING_SECRET: z.string().default("dev-mcp-signing-secret-change-me-000"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().default("dev-encryption-key-change-in-prod!!"),
  /** Telnyx SMS (default notification channel). All four required to enable. */
  TELNYX_API_KEY: z.string().optional(),
  /** Base64 Ed25519 public key from the Telnyx portal, for webhook signatures. */
  TELNYX_PUBLIC_KEY: z.string().optional(),
  TELNYX_MESSAGING_PROFILE_ID: z.string().optional(),
  /** E.164 sender number owned by the messaging profile. */
  TELNYX_FROM_NUMBER: z.string().optional(),
});

export const env = EnvSchema.parse(process.env);
export const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const telnyxEnabled = Boolean(env.TELNYX_API_KEY && env.TELNYX_FROM_NUMBER);
