import { generateText, stepCountIs, type LanguageModel } from "ai";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { buildUserPrompt, SYSTEM_PROMPT } from "./prompt";
import type { AgentRunResult, AgentToolStep, McpConnection, RunAgentArgs } from "./types";

export type AgentRuntimeConfig = {
  model: LanguageModel;
  provider: string;
  modelId: string;
  /** Max model turns (tool rounds + final answer). */
  maxSteps?: number;
  /** Wall-clock budget for the whole run. */
  timeoutMs?: number;
};

const DEFAULT_MAX_STEPS = 8;
const DEFAULT_TIMEOUT_MS = 90_000;

export const AGENT_ERROR_REPLY = "Sorry — I hit a snag handling that. Mind trying again?";

/**
 * The open-source harness: Vercel AI SDK `generateText` running a bounded
 * tool loop over the Fambot MCP surface. Provider-neutral by construction —
 * the model and the MCP transport are both injected.
 */
export async function runAgent(
  config: AgentRuntimeConfig,
  args: RunAgentArgs
): Promise<AgentRunResult> {
  const startedAt = Date.now();
  const steps: AgentToolStep[] = [];

  let client: MCPClient | null = null;
  try {
    client = await createMCPClient({
      transport: toTransportConfig(args.mcp),
      clientName: "fambot-agent",
      protocolVersionDiscovery: false,
    });
    const tools = await client.tools();

    const result = await generateText({
      model: config.model,
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(args.input),
      tools,
      stopWhen: stepCountIs(config.maxSteps ?? DEFAULT_MAX_STEPS),
      abortSignal: AbortSignal.timeout(config.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      onStepEnd: async (step) => {
        for (const toolResult of step.toolResults) {
          const parsed = parseToolStep(toolResult);
          steps.push(parsed);
          try {
            await args.onToolStep?.(parsed);
          } catch {
            // Progress delivery must never break the run.
          }
        }
      },
    });

    return {
      reply: result.text.trim() || fallbackReplyFrom(steps),
      steps,
      meta: {
        provider: config.provider,
        model: config.modelId,
        inputTokens: result.totalUsage?.inputTokens,
        outputTokens: result.totalUsage?.outputTokens,
        latencyMs: Date.now() - startedAt,
        status: "ok",
      },
    };
  } catch (error) {
    return {
      reply: AGENT_ERROR_REPLY,
      steps,
      meta: {
        provider: config.provider,
        model: config.modelId,
        latencyMs: Date.now() - startedAt,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    await client?.close().catch(() => {});
  }
}

function toTransportConfig(mcp: McpConnection) {
  if ("transport" in mcp) return mcp.transport;
  return { type: "http" as const, url: mcp.url, headers: mcp.headers };
}

/**
 * Fambot MCP tools return a structured JSON ToolResult as text content;
 * parse it back out. Anything unexpected degrades to a "failed" step.
 */
function parseToolStep(toolResult: {
  toolName: string;
  input: unknown;
  output: unknown;
}): AgentToolStep {
  const base = { toolName: toolResult.toolName, args: toolResult.input };
  try {
    const output = toolResult.output as { content?: Array<{ type: string; text?: string }> };
    const text = output?.content?.find((c) => c.type === "text")?.text;
    if (!text) throw new Error("no text content");
    const parsed = JSON.parse(text) as { status?: string; message?: string; data?: unknown };
    const status =
      parsed.status === "executed" ||
      parsed.status === "rejected" ||
      parsed.status === "clarify" ||
      parsed.status === "failed"
        ? parsed.status
        : "failed";
    return { ...base, status, message: parsed.message ?? "", data: parsed.data ?? null };
  } catch {
    return { ...base, status: "failed", message: "Tool returned an unreadable result.", data: null };
  }
}

/** If the model somehow returns no text, fall back to the last tool message. */
function fallbackReplyFrom(steps: AgentToolStep[]): string {
  const last = [...steps].reverse().find((s) => s.message);
  return last?.message ?? "Done.";
}
