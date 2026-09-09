export * from "./types";
export * from "./prompt";
export * from "./openai-provider";

import type { AIProvider } from "./types";
import { OpenAIProvider } from "./openai-provider";

/** Builds the OpenAI provider. A real API key is required — there is no fallback. */
export function createAIProvider(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): AIProvider {
  if (!env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not set. Add it to apps/api/.env — the API cannot interpret messages without it."
    );
  }
  return new OpenAIProvider({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL,
  });
}
