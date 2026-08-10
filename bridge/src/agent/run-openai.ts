import type { AgentRequest, ToolPort } from "./types.js";

export interface OpenAiAgentOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
  tools: ToolPort;
  /** Test seam. */
  fetchFn?: typeof fetch;
}

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

const MAX_TOOL_ROUNDS = 12;

/**
 * Built-in agent loop for bare OpenAI-compatible model servers (osaurus,
 * LM Studio, any /v1/chat/completions endpoint with tool calling). The bridge
 * drives the loop; tool calls execute against FamBot's MCP server.
 */
export async function runOpenAiAgent(request: AgentRequest, options: OpenAiAgentOptions): Promise<string> {
  const fetchFn = options.fetchFn ?? fetch;
  const deadline = Date.now() + options.timeoutMs;

  const toolSpecs = await options.tools.list();
  const tools = toolSpecs.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description ?? "", parameters: t.inputSchema },
  }));

  const messages: ChatMessage[] = [
    { role: "system", content: request.system },
    { role: "user", content: request.user },
  ];

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error(`agent timed out after ${options.timeoutMs}ms`);

      const res = await fetchFn(`${options.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: options.model, messages, tools, tool_choice: "auto" }),
        signal: AbortSignal.timeout(remaining),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`chat completion failed (${res.status}): ${body.slice(0, 400)}`);
      }
      const data = (await res.json()) as {
        choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
      };
      const message = data.choices?.[0]?.message;
      if (!message) throw new Error("chat completion returned no choices");

      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        const reply = message.content?.trim();
        if (!reply) throw new Error("model returned an empty reply");
        return reply;
      }

      messages.push({ role: "assistant", content: message.content ?? null, tool_calls: toolCalls });
      for (const call of toolCalls) {
        let result: string;
        try {
          const args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
          result = await options.tools.call(call.function.name, args);
        } catch (err) {
          result = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
        }
        console.log(
          `[agent]   tool ${call.function.name}(${(call.function.arguments ?? "").slice(0, 160)}) → ${result.slice(0, 200).replace(/\n/g, " ")}`,
        );
        messages.push({ role: "tool", content: result, tool_call_id: call.id });
      }
    }
    throw new Error(`agent exceeded ${MAX_TOOL_ROUNDS} tool rounds without a final reply`);
  } finally {
    await options.tools.close().catch(() => {});
  }
}
