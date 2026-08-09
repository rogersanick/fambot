import { test } from "node:test";
import assert from "node:assert/strict";
import { runCliAgent } from "./run-cli.js";

const request = { system: "You are FamBot.", user: "Chat GUID: abc\nThe message: @fambot hi" };

test("pipes the prompt to stdin and returns stdout", async () => {
  const reply = await runCliAgent(request, { command: "cat", timeoutMs: 5000, env: {} });
  assert.ok(reply.includes("You are FamBot."));
  assert.ok(reply.includes("@fambot hi"));
});

test("exposes FAMBOT_MCP_URL and FAMBOT_MCP_TOKEN to the command", async () => {
  const reply = await runCliAgent(request, {
    command: 'echo "$FAMBOT_MCP_URL|$FAMBOT_MCP_TOKEN"',
    timeoutMs: 5000,
    env: { FAMBOT_MCP_URL: "http://localhost:3000/mcp", FAMBOT_MCP_TOKEN: "jwt-123" },
  });
  assert.equal(reply, "http://localhost:3000/mcp|jwt-123");
});

test("rejects on non-zero exit with stderr excerpt", async () => {
  await assert.rejects(
    runCliAgent(request, { command: "echo boom >&2; exit 3", timeoutMs: 5000, env: {} }),
    /exited 3: boom/,
  );
});

test("rejects on empty output", async () => {
  await assert.rejects(runCliAgent(request, { command: "true", timeoutMs: 5000, env: {} }), /no output/);
});

test("kills and rejects on timeout", async () => {
  const started = Date.now();
  await assert.rejects(
    runCliAgent(request, { command: "sleep 10", timeoutMs: 200, env: {} }),
    /timed out/,
  );
  assert.ok(Date.now() - started < 2000);
});
