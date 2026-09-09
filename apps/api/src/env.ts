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
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),
  OPENAI_BASE_URL: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().default("dev-encryption-key-change-in-prod!!"),
});

export const env = EnvSchema.parse(process.env);
export const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
