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

test("a reply claiming an action with no mutating tool call is challenged, prompting the real call", async () => {
  const { port, calls } = makeTools();
  const fetchFn = scriptedFetch([
    // Hallucination: claims success without calling anything.
    { choices: [{ message: { content: "I've created a reminder for Nick at noon today." } }] },
    // After the challenge, the model actually does the work.
    {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: "c1", type: "function", function: { name: "create_reminder", arguments: '{"message":"dress"}' } },
            ],
          },
        },
      ],
    },
    { choices: [{ message: { content: "Reminder set for Nick at noon ✓" } }] },
  ]);
  const reply = await runOpenAiAgent(request, {
    baseUrl: "http://fake/v1",
    model: "m",
    timeoutMs: 5000,
    tools: port,
    fetchFn,
  });
  assert.equal(reply, "Reminder set for Nick at noon ✓");
  assert.deepEqual(calls.map((c) => c.name), ["create_reminder"]);
  const second = JSON.parse((fetchFn as unknown as { bodies: string[] }).bodies[1]!);
  const challenge = second.messages.at(-1);
  assert.equal(challenge.role, "user");
  assert.match(challenge.content, /ONLY chance to act/);
});

test("action claims are accepted when a mutating tool succeeded this run", async () => {
  const { port } = makeTools();
  const fetchFn = scriptedFetch([
    {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: "c1", type: "function", function: { name: "create_reminder", arguments: "{}" } },
            ],
          },
        },
      ],
    },
    { choices: [{ message: { content: "I've created the reminder for noon." } }] },
  ]);
  const reply = await runOpenAiAgent(request, {
    baseUrl: "http://fake/v1",
    model: "m",
    timeoutMs: 5000,
    tools: port,
    fetchFn,
  });
  assert.equal(reply, "I've created the reminder for noon.");
  assert.equal((fetchFn as unknown as { bodies: string[] }).bodies.length, 2);
});

test("a status claim after a successful list call is grounded, not challenged", async () => {
  const { port } = makeTools('[{"id":"r1","message":"dress","fire_at":"2026-08-10T16:00:00Z"}]');
  const fetchFn = scriptedFetch([
    {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: "c1", type: "function", function: { name: "list_reminders", arguments: "{}" } },
            ],
          },
        },
      ],
    },
    { choices: [{ message: { content: "Yes — your reminder is set for noon today." } }] },
  ]);
  const reply = await runOpenAiAgent(request, {
    baseUrl: "http://fake/v1",
    model: "m",
    timeoutMs: 5000,
    tools: port,
    fetchFn,
  });
  assert.equal(reply, "Yes — your reminder is set for noon today.");
  assert.equal((fetchFn as unknown as { bodies: string[] }).bodies.length, 2);
});

test("a future-tense promise without a tool call is challenged into acting", async () => {
  const { port, calls } = makeTools();
  const fetchFn = scriptedFetch([
    // Empty promise: the run ends after the reply, so nothing would happen.
    { choices: [{ message: { content: "I'll set a reminder for 4pm today (2026-08-10T20:00:00-04:00)." } }] },
    {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: "c1", type: "function", function: { name: "create_reminder", arguments: '{"message":"therapy"}' } },
            ],
          },
        },
      ],
    },
    { choices: [{ message: { content: "Reminder set for 4pm today ✓" } }] },
  ]);
  const reply = await runOpenAiAgent(request, {
    baseUrl: "http://fake/v1",
    model: "m",
    timeoutMs: 5000,
    tools: port,
    fetchFn,
  });
  assert.equal(reply, "Reminder set for 4pm today ✓");
  assert.deepEqual(calls.map((c) => c.name), ["create_reminder"]);
});

test("a present-progressive claim ('I'm adding…') without a tool call is challenged", async () => {
  const { port, calls } = makeTools();
  const fetchFn = scriptedFetch([
    { choices: [{ message: { content: "Got it, I'm adding black wax cheese to the Costco list." } }] },
    {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: "c1", type: "function", function: { name: "create_task", arguments: '{"title":"Black wax cheese"}' } },
            ],
          },
        },
      ],
    },
    { choices: [{ message: { content: "Added black wax cheese to the list ✓" } }] },
  ]);
  const reply = await runOpenAiAgent(request, {
    baseUrl: "http://fake/v1",
    model: "m",
    timeoutMs: 5000,
    tools: port,
    fetchFn,
  });
  assert.equal(reply, "Added black wax cheese to the list ✓");
  assert.deepEqual(calls.map((c) => c.name), ["create_task"]);
});

test("a promise that asks a clarifying question is allowed", async () => {
  const { port } = makeTools();
  const fetchFn = scriptedFetch([
    { choices: [{ message: { content: "I'll create a matching one for Nick — same time?" } }] },
  ]);
  const reply = await runOpenAiAgent(request, {
    baseUrl: "http://fake/v1",
    model: "m",
    timeoutMs: 5000,
    tools: port,
    fetchFn,
  });
  assert.equal(reply, "I'll create a matching one for Nick — same time?");
  assert.equal((fetchFn as unknown as { bodies: string[] }).bodies.length, 1);
});

test("the challenge fires at most once per run", async () => {
  const { port } = makeTools();
  const fetchFn = scriptedFetch([
    { choices: [{ message: { content: "I've created a reminder." } }] },
    { choices: [{ message: { content: "I've created a reminder, promise." } }] },
  ]);
  const reply = await runOpenAiAgent(request, {
    baseUrl: "http://fake/v1",
    model: "m",
    timeoutMs: 5000,
    tools: port,
    fetchFn,
  });
  assert.equal(reply, "I've created a reminder, promise.");
  assert.equal((fetchFn as unknown as { bodies: string[] }).bodies.length, 2);
});

test("a failed mutating tool call does not license an action claim", async () => {
  const { port } = makeTools('{"error":"fire_at is in the past"}');
  const fetchFn = scriptedFetch([
    {
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { id: "c1", type: "function", function: { name: "create_reminder", arguments: "{}" } },
            ],
          },
        },
      ],
    },
    { choices: [{ message: { content: "I've scheduled the reminder." } }] },
    { choices: [{ message: { content: "Sorry — I couldn't schedule it: the time was in the past." } }] },
  ]);
  const reply = await runOpenAiAgent(request, {
    baseUrl: "http://fake/v1",
    model: "m",
    timeoutMs: 5000,
    tools: port,
    fetchFn,
  });
  assert.equal(reply, "Sorry — I couldn't schedule it: the time was in the past.");
});

test("empty final reply is an error", async () => {
  const { port } = makeTools();
  const fetchFn = scriptedFetch([{ choices: [{ message: { content: "" } }] }]);
  await assert.rejects(
    runOpenAiAgent(request, { baseUrl: "http://fake/v1", model: "m", timeoutMs: 5000, tools: port, fetchFn }),
    /empty reply/,
  );
});
