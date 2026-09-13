export * from "./types";
export * from "./prompt";
export * from "./model";
export * from "./runtime";
export * from "./progress";
export { summarizeStatus } from "./summarize";

import { createOpenAIModel } from "./model";
import { runAgent, type AgentRuntimeConfig } from "./runtime";
import { summarizeStatus } from "./summarize";
import type { AIRuntime } from "./types";

export class AIUnavailableError extends Error {
  readonly code = "AI_NOT_CONFIGURED";

  constructor() {
    super("OPENAI_API_KEY is not configured");
    this.name = "AIUnavailableError";
  }
}

const unavailableRuntime: AIRuntime = {
  configured: false,
  async runAgent() {
    throw new AIUnavailableError();
  },
  async summarizeStatus() {
    return null;
  },
};

/**
 * Builds the default cloud runtime (OpenAI via the AI SDK). Without a key,
 * only the agent is disabled; the rest of the API (auth, CRUD, health
 * checks) remains available. `createAgentRuntime` is the provider-neutral
 * seam for future on-device models.
 */
export function createAIRuntime(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): AIRuntime {
  if (!env.OPENAI_API_KEY) {
    return unavailableRuntime;
  }
  const configured = createOpenAIModel({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL,
    baseUrl: env.OPENAI_BASE_URL,
  });
  return createAgentRuntime({
    model: configured.model,
    provider: configured.provider,
    modelId: configured.modelId,
  });
}

/** Wrap any LanguageModel (cloud or local) as the Fambot runtime. */
export function createAgentRuntime(config: AgentRuntimeConfig): AIRuntime {
  return {
    configured: true,
    runAgent: (args) => runAgent(config, args),
    summarizeStatus: (input) => summarizeStatus(config.model, input),
  };
}
