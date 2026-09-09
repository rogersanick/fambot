import { z } from "zod";
import { InterpretationSchema } from "@fambot/shared";
import type { AIProvider, InterpretationInput, InterpretationResult } from "./types";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";

export type OpenAIProviderOptions = {
  apiKey: string;
  model?: string;
  baseUrl?: string;
};

/**
 * OpenAI chat-completions provider using strict structured outputs.
 * One call, one retry with the validation error appended, then a clarify
 * fallback. No tool loop, no MCP.
 */
export class OpenAIProvider implements AIProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly jsonSchema: Record<string, unknown>;

  constructor(opts: OpenAIProviderOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? "gpt-5-mini";
    this.baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    this.jsonSchema = toStrictJsonSchema(InterpretationSchema);
  }

  async interpret(input: InterpretationInput): Promise<InterpretationResult> {
    const start = Date.now();
    const messages: Array<{ role: string; content: string }> = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ];

    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let lastError = "";

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            response_format: {
              type: "json_schema",
              json_schema: { name: "interpretation", strict: true, schema: this.jsonSchema },
            },
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`openai ${res.status}: ${body.slice(0, 500)}`);
        }
        const data = (await res.json()) as {
          choices: Array<{ message: { content: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        inputTokens = (inputTokens ?? 0) + (data.usage?.prompt_tokens ?? 0);
        outputTokens = (outputTokens ?? 0) + (data.usage?.completion_tokens ?? 0);

        const raw = data.choices[0]?.message?.content ?? "";
        const parsed = InterpretationSchema.safeParse(JSON.parse(raw));
        if (parsed.success) {
          return {
            actions: parsed.data.actions,
            meta: {
              provider: "openai",
              model: this.model,
              inputTokens,
              outputTokens,
              latencyMs: Date.now() - start,
              status: "ok",
            },
          };
        }
        lastError = z.prettifyError(parsed.error);
        // Feed the validation error back for one corrective attempt.
        messages.push({ role: "assistant", content: raw });
        messages.push({
          role: "user",
          content: `Your output failed validation:\n${lastError}\nReturn corrected JSON matching the schema.`,
        });
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt === 0) continue;
        return {
          actions: [
            { type: "clarify", question: "Sorry, I hit a snag understanding that. Could you rephrase?" },
          ],
          meta: {
            provider: "openai",
            model: this.model,
            inputTokens,
            outputTokens,
            latencyMs: Date.now() - start,
            status: "error",
            error: lastError,
          },
        };
      }
    }

    // Both attempts produced schema-invalid output.
    return {
      actions: [
        { type: "clarify", question: "I couldn't quite work out what you want — can you say it another way?" },
      ],
      meta: {
        provider: "openai",
        model: this.model,
        inputTokens,
        outputTokens,
        latencyMs: Date.now() - start,
        status: "invalid_output",
        error: lastError,
      },
    };
  }
}

/**
 * OpenAI strict mode requires: every object has additionalProperties=false
 * and all keys required. Zod v4's toJSONSchema gets most of the way; this
 * post-pass enforces the strict-mode invariants recursively.
 */
export function toStrictJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  walk(json);
  return json;

  function walk(node: unknown): void {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (obj.type === "object" || obj.properties) {
      obj.additionalProperties = false;
      if (obj.properties && typeof obj.properties === "object") {
        obj.required = Object.keys(obj.properties as Record<string, unknown>);
      }
    }
    for (const value of Object.values(obj)) walk(value);
  }
}
