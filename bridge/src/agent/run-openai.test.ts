import { test } from "node:test";
import assert from "node:assert/strict";
import { runOpenAiAgent } from "./run-openai.js";
import type { ToolPort } from "./types.js";

const request = { system: "You are FamBot.", user: "@fambot add milk" };

function makeTools(callResult = '{"id":"t1"}') {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  let closed = false;
  const port: ToolPort = {
    async list() {
      return [
        {
          name: "create_task",
          description: "Add a todo",
          inputSchema: { type: "object", properties: { title: { type: "string" } } },
        },
      ];
    },
    async call(name, args) {
      calls.push({ name, args });
      return callResult;
    },
    async close() {
      closed = true;
    },
  };
  return { port, calls, isClosed: () => closed };
}

function scriptedFetch(responses: object[]): typeof fetch {
  let i = 0;
  const bodies: string[] = [];
  const fn = (async (_url: unknown, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    const body = responses[Math.min(i++, responses.length - 1)];
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  (fn as unknown as { bodies: string[] }).bodies = bodies;
  return fn;
}

test("runs the tool loop: tool call then final reply", async () => {
  const { port, calls, isClosed } = makeTools();
  const fetchFn = scriptedFetch([
    {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: "c1", type: "function", function: { name: "create_task", arguments: '{"title":"milk"}' } },
            ],
          },
        },
      ],
    },
    { choices: [{ message: { content: "Added milk to the list ✓" } }] },
  ]);

  const reply = await runOpenAiAgent(request, {
    baseUrl: "http://fake/v1",
    model: "test-model",
    timeoutMs: 5000,
    tools: port,
    fetchFn,
  });

  assert.equal(reply, "Added milk to the list ✓");
  assert.deepEqual(calls, [{ name: "create_task", args: { title: "milk" } }]);
  assert.ok(isClosed(), "tool port should be closed after the run");

  // Second request must include the tool result message.
  const bodies = (fetchFn as unknown as { bodies: string[] }).bodies;
  const second = JSON.parse(bodies[1]!);
  const toolMsg = second.messages.find((m: { role: string }) => m.role === "tool");
  assert.equal(toolMsg.tool_call_id, "c1");
  assert.equal(toolMsg.content, '{"id":"t1"}');
});

test("advertises MCP tools as OpenAI function specs", async () => {
  const { port } = makeTools();
  const fetchFn = scriptedFetch([{ choices: [{ message: { content: "hi" } }] }]);
  await runOpenAiAgent(request, {
    baseUrl: "http://fake/v1",
    model: "m",
    timeoutMs: 5000,
    tools: port,
    fetchFn,
  });
  const body = JSON.parse((fetchFn as unknown as { bodies: string[] }).bodies[0]!);
  assert.equal(body.tools[0].function.name, "create_task");
  assert.equal(body.tools[0].function.parameters.type, "object");
});

test("tool errors are fed back to the model, not fatal", async () => {
  const { port } = makeTools();
  port.call = async () => {
    throw new Error("no household");
  };
  const fetchFn = scriptedFetch([
    {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: "c1", type: "function", function: { name: "list_tasks", arguments: "{}" } }],
          },
        },
      ],
    },
    { choices: [{ message: { content: "You need to set up a household first." } }] },
  ]);
  const reply = await runOpenAiAgent(request, {
    baseUrl: "http://fake/v1",
    model: "m",
    timeoutMs: 5000,
    tools: port,
    fetchFn,
  });
  assert.equal(reply, "You need to set up a household first.");
  const second = JSON.parse((fetchFn as unknown as { bodies: string[] }).bodies[1]!);
  const toolMsg = second.messages.find((m: { role: string }) => m.role === "tool");
  assert.ok(toolMsg.content.includes("no household"));
});

test("empty final reply is an error", async () => {
  const { port } = makeTools();
  const fetchFn = scriptedFetch([{ choices: [{ message: { content: "" } }] }]);
  await assert.rejects(
    runOpenAiAgent(request, { baseUrl: "http://fake/v1", model: "m", timeoutMs: 5000, tools: port, fetchFn }),
    /empty reply/,
  );
});
