import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

export const DEFAULT_OPENAI_MODEL = "gpt-5-mini";

export type ConfiguredModel = {
  model: LanguageModel;
  provider: string;
  modelId: string;
};

/**
 * The single place a concrete provider is chosen. The runtime itself only
 * sees a LanguageModel, so future on-device (Tauri) or self-hosted models
 * plug in by returning a different ConfiguredModel here.
 */
export function createOpenAIModel(config: {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}): ConfiguredModel {
  const modelId = config.model ?? DEFAULT_OPENAI_MODEL;
  const openai = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseUrl });
  return { model: openai(modelId), provider: "openai", modelId };
}
