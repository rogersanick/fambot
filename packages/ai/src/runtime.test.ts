import { describe, expect, test } from "bun:test";
import { MockLanguageModelV3, MockLanguageModelV4 } from "ai/test";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAIRuntime, AIUnavailableError } from "./index";
import { runAgent } from "./runtime";
import { ProgressReporter } from "./progress";
import type { AgentInput, AgentToolStep } from "./types";

const INPUT: AgentInput = {
  nowLocal: "2026-09-09T10:00",
  timezone: "America/New_York",
  senderName: "Nick",
  participantNames: ["Nick"],
  isGroup: false,
  recentTurns: [],
  text: "make a groceries list",
};

/** A tiny real MCP server (same SDK the registry uses) with one tool. */
async function startFakeMcpServer(callLog: unknown[]) {
  const server = new Server({ name: "fake", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "create_list",
        description: "Create a checklist.",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    callLog.push(request.params);
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({
            status: "executed",
            message: '✓ List "groceries" is ready.',
            data: { listId: "list-1" },
          }),
        },
      ],
    };
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  return clientTransport;
}

function v4Usage(inputTokens: number, outputTokens: number) {
  return {
    inputTokens: { total: inputTokens, noCache: undefined, cacheRead: undefined, cacheWrite: undefined },
    outputTokens: { total: outputTokens, text: undefined, reasoning: undefined },
  };
}

/** Mock model: first turn calls the tool, second turn answers in text. */
function toolLoopModel() {
  let call = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      call += 1;
      if (call === 1) {
        return {
          content: [
            {
              type: "tool-call" as const,
              toolCallId: "call-1",
              toolName: "create_list",
              input: JSON.stringify({ name: "groceries" }),
            },
          ],
          finishReason: { unified: "tool-calls" as const, raw: "tool-calls" },
          usage: v4Usage(100, 20),
          warnings: [],
        };
      }
      return {
        content: [{ type: "text" as const, text: "Your groceries list is ready!" }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: v4Usage(150, 10),
        warnings: [],
      };
    },
  });
}

describe("runAgent tool loop", () => {
  test("runs the loop over MCP, records steps, returns final text and usage", async () => {
    const callLog: unknown[] = [];
    const transport = await startFakeMcpServer(callLog);
    const progressed: AgentToolStep[] = [];

    const result = await runAgent(
      { model: toolLoopModel(), provider: "mock", modelId: "mock-1" },
      {
        mcp: { transport },
        input: INPUT,
        onToolStep: (step) => {
          progressed.push(step);
        },
      }
    );

    expect(result.meta.status).toBe("ok");
    expect(result.reply).toBe("Your groceries list is ready!");
    expect(callLog.length).toBe(1);
    expect(result.steps.length).toBe(1);
    expect(result.steps[0]!.toolName).toBe("create_list");
    expect(result.steps[0]!.status).toBe("executed");
    expect(result.steps[0]!.message).toContain("groceries");
    expect(progressed.length).toBe(1);
    expect(result.meta.inputTokens).toBe(250); // summed across turns
  });

  test("model/transport errors return a safe error result, never throw", async () => {
    const failing = new MockLanguageModelV3({
      doGenerate: async () => {
        throw new Error("model exploded");
      },
    });
    const transport = await startFakeMcpServer([]);
    const result = await runAgent(
      { model: failing, provider: "mock", modelId: "mock-1" },
      { mcp: { transport }, input: INPUT }
    );
    expect(result.meta.status).toBe("error");
    expect(result.meta.error).toContain("model exploded");
    expect(result.reply.length).toBeGreaterThan(0);
  });

  test("unconfigured runtime throws AIUnavailableError from runAgent only", async () => {
    const runtime = createAIRuntime({});
    expect(runtime.configured).toBe(false);
    expect(await runtime.summarizeStatus({} as never)).toBeNull();
    expect(
      runtime.runAgent({ mcp: { url: "http://localhost:0/mcp" }, input: INPUT })
    ).rejects.toBeInstanceOf(AIUnavailableError);
  });
});

describe("ProgressReporter", () => {
  const step = (toolName: string, message: string): AgentToolStep => ({
    toolName,
    args: {},
    status: "executed",
    message,
    data: null,
  });

  test("stays silent before the delay gate", async () => {
    const sent: string[] = [];
    const reporter = new ProgressReporter({
      send: async (t) => {
        sent.push(t);
      },
      minDelayMs: 60_000,
    });
    await reporter.onToolStep(step("create_task", "✓ Task added"));
    expect(sent).toEqual([]);
  });

  test("dedupes identical updates and enforces the per-run cap", async () => {
    const sent: string[] = [];
    const reporter = new ProgressReporter({
      send: async (t) => {
        sent.push(t);
      },
      minDelayMs: 0,
      maxUpdates: 2,
    });
    await reporter.onToolStep(step("list_tasks", "5 task(s)."));
    await reporter.onToolStep(step("list_lists", "2 list(s)."));// same read template → deduped
    await reporter.onToolStep(step("add_list_items", '✓ Added "milk"'));
    await reporter.onToolStep(step("create_task", "✓ Task added")); // over cap
    expect(sent).toEqual(["Looking that up…", '✓ Added "milk"']);
  });

  test("failed steps and send failures are swallowed", async () => {
    const reporter = new ProgressReporter({
      send: async () => {
        throw new Error("channel down");
      },
      minDelayMs: 0,
    });
    await reporter.onToolStep({ ...step("create_task", "nope"), status: "failed" });
    await reporter.onToolStep(step("create_task", "✓ Task added")); // must not throw
  });
});
