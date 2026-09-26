import { z } from "zod";

/**
 * Slim relay config. The bridge is transport only: it never runs an agent,
 * never touches the database, never builds prompts.
 */
const ConfigSchema = z.object({
  API_URL: z.string().default("http://localhost:8787"),
  BRIDGE_TOKEN: z.string().default("dev-bridge-token"),
  BRIDGE_MEMBER_ID: z.string().uuid().optional(),
  IMSG_BIN: z.string().default("imsg"),
  BOT_MESSAGE_PREFIX: z.string().default("Fambot says"),
  STATE_PATH: z.string().default("./data/state.json"),
});

export type BridgeConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  return ConfigSchema.parse(env);
}
