import { generateText, type LanguageModel } from "ai";
import { buildStatusSummaryPrompt, STATUS_SUMMARY_SYSTEM_PROMPT } from "./prompt";
import type { StatusSummaryInput } from "./types";

/**
 * Constrained second pass over an (untrusted) comment thread. Returns null on
 * any failure so callers fall back to rendering the comments verbatim.
 */
export async function summarizeStatus(
  model: LanguageModel,
  input: StatusSummaryInput
): Promise<string | null> {
  try {
    const result = await generateText({
      model,
      system: STATUS_SUMMARY_SYSTEM_PROMPT,
      prompt: buildStatusSummaryPrompt(input),
      abortSignal: AbortSignal.timeout(20_000),
    });
    const text = result.text.trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}
