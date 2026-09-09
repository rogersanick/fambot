import { describe, expect, test } from "bun:test";
import { InterpretationSchema } from "@fambot/shared";
import { OpenAIProvider, toStrictJsonSchema } from "./openai-provider";

describe("toStrictJsonSchema", () => {
  test("every object node is strict (additionalProperties=false, all keys required)", () => {
    const schema = toStrictJsonSchema(InterpretationSchema);
    const problems: string[] = [];
    (function walk(node: unknown, path: string) {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
      if (node === null || typeof node !== "object") return;
      const obj = node as Record<string, unknown>;
      if (obj.type === "object" || obj.properties) {
        if (obj.additionalProperties !== false) problems.push(`${path}: additionalProperties`);
        const keys = Object.keys((obj.properties as object) ?? {});
        const required = (obj.required as string[]) ?? [];
        if (keys.some((k) => !required.includes(k))) problems.push(`${path}: required`);
      }
      for (const [k, v] of Object.entries(obj)) walk(v, `${path}.${k}`);
    })(schema, "$");
    expect(problems).toEqual([]);
  });
});

describe("OpenAIProvider retry behavior", () => {
  const input = {
    nowLocal: "2026-09-08T20:00:00",
    timezone: "America/New_York",
    senderName: "Nick",
    participantNames: ["Nick"],
    isGroup: false,
    recentTurns: [],
    text: "remind me at 5 to call mom",
  };

  function mockFetch(bodies: string[]): typeof fetch {
    let i = 0;
    return (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: bodies[Math.min(i++, bodies.length - 1)] } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200 }
      )) as unknown as typeof fetch;
  }

  test("invalid then valid output: retry recovers", async () => {
    const good = JSON.stringify({
      actions: [
        {
          type: "create_reminder",
          title: "call mom",
          fire_at: "2026-09-08T17:00:00",
          rrule: null,
          target: "sender",
          target_name: null,
        },
      ],
    });
    const provider = new OpenAIProvider({ apiKey: "test" });
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetch([JSON.stringify({ actions: [{ type: "nope" }] }), good]);
    try {
      const result = await provider.interpret(input);
      expect(result.meta.status).toBe("ok");
      expect(result.actions[0]?.type).toBe("create_reminder");
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("persistently invalid output falls back to clarify", async () => {
    const provider = new OpenAIProvider({ apiKey: "test" });
    const orig = globalThis.fetch;
    globalThis.fetch = mockFetch([JSON.stringify({ nope: true })]);
    try {
      const result = await provider.interpret(input);
      expect(result.meta.status).toBe("invalid_output");
      expect(result.actions[0]?.type).toBe("clarify");
    } finally {
      globalThis.fetch = orig;
    }
  });
});
