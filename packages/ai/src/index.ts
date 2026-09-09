export * from "./types";
export * from "./prompt";
export * from "./openai-provider";
export * from "./fake-provider";

import type { AIProvider } from "./types";
import { OpenAIProvider } from "./openai-provider";
import { FakeAIProvider } from "./fake-provider";

/** Picks OpenAI when a key is configured, otherwise the deterministic fake. */
export function createAIProvider(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): AIProvider {
  if (env.OPENAI_API_KEY) {
    return new OpenAIProvider({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      baseUrl: env.OPENAI_BASE_URL,
    });
  }
  console.warn("[ai] OPENAI_API_KEY not set — using FakeAIProvider (demo mode)");
  return new FakeAIProvider();
}
