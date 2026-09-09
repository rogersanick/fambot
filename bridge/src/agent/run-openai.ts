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

/** Tools whose success is required before the model may claim it "did" something. */
const MUTATING_TOOL = /^(create_|update_|delete_|cancel_|add_|setup_|map_)/;

/** Read tools that ground status statements ("your reminder is set for noon"). */
const GROUNDING_TOOL = /^list_/;

/**
 * Replies asserting a state change happened ("I've created a reminder…",
 * "Reminder set for noon"). Small local models emit these without calling any
 * tool; catching them here keeps FamBot from lying to the family.
 */
const ACTION_CLAIM =
  /\b(?:i(?:'ve| have| just)? (?:already )?(?:created|scheduled|set(?: up)?|added|updated|cancell?ed|deleted|removed|made)|(?:reminder|task|event)s? (?:is |are |was |were |has been |have been )?(?:set|created|scheduled|added|cancell?ed|updated))\b/i;

/**
 * Promises and in-progress claims of action — future ("I'll set a reminder"),
 * present progressive ("I'm adding it now"), or "let me add…". The run ends at
 * the final reply, so these are as empty as a false past-tense claim: nothing
 * will ever execute them. Replies containing "?" are exempt: "I'll create one
 * for Nick — same time?" is a legitimate clarifying question.
 */
const PROMISE_CLAIM =
  /\b(?:i(?:'ll| will|'m| am)(?: just)?(?: now)?(?: going to| gonna)?|let me)(?: go ahead and)?\s+(?:set(?:ting)?|creat(?:e|ing)|schedul(?:e|ing)|add(?:ing)?|updat(?:e|ing)|cancel(?:l?ing)?|delet(?:e|ing)|remov(?:e|ing)|mak(?:e|ing))\b/i;

const CHALLENGE_MESSAGE =
  "SYSTEM CHECK: your reply claims an action happened or promises to do it, but no state-changing tool succeeded in this run — and this run is your ONLY chance to act (after replying you stop until someone tags you again, so 'I'll do it' means it never happens). If the user asked you to do something, call the tool that does it NOW, then confirm. If you believe it already exists, verify with the matching list_ tool first. Otherwise rewrite your reply to honestly say what you actually did (or could not do).";

function isErrorResult(result: string): boolean {
  try {
    const value: unknown = JSON.parse(result);
    return typeof value === "object" && value !== null && "error" in value;
  } catch {
    return false;
  }
}

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

  let mutated = false; // a state-changing tool succeeded this run
  let grounded = false; // a list_ tool succeeded — status claims are informed
  let challenged = false; // the hallucination challenge fires at most once

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
        const falseClaim = !mutated && !grounded && ACTION_CLAIM.test(reply);
        const emptyPromise = !mutated && !reply.includes("?") && PROMISE_CLAIM.test(reply);
        if (!challenged && (falseClaim || emptyPromise)) {
          challenged = true;
          console.warn(`[agent] reply claims an action but no state-changing tool succeeded — challenging: "${reply.slice(0, 100)}"`);
          messages.push({ role: "assistant", content: reply });
          messages.push({ role: "user", content: CHALLENGE_MESSAGE });
          continue;
        }
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
        if (!isErrorResult(result)) {
          if (MUTATING_TOOL.test(call.function.name)) mutated = true;
          else if (GROUNDING_TOOL.test(call.function.name)) grounded = true;
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
