import { test } from "node:test";
import assert from "node:assert/strict";
import { ReminderPoller } from "./reminders.js";
import type { AgentSession } from "./supabase-session.js";

type QueryResult = { data: unknown[] | null; error: { message: string } | null };

/**
 * Thenable stand-in for the supabase-js query builder: every chain method
 * returns itself; awaiting it resolves via the provided implementation.
 */
class FakeQuery implements PromiseLike<QueryResult> {
  op: "select" | "update" = "select";

  constructor(private readonly impl: (op: "select" | "update") => Promise<QueryResult>) {}

  select(): this {
    this.op = "select";
    return this;
  }
  update(): this {
    this.op = "update";
    return this;
  }
  eq(): this {
    return this;
  }
  lte(): this {
    return this;
  }
  not(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  order(): this {
    return this;
  }

  then<T1 = QueryResult, T2 = never>(
    onfulfilled?: ((value: QueryResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return this.impl(this.op).then(onfulfilled, onrejected);
  }
}

interface Harness {
  poller: ReminderPoller;
  calls: string[];
  sent: { chatGuid: string; text: string }[];
  logged: { error: string[]; log: string[] };
  restore: () => void;
}

function makeHarness(opts: {
  select: () => Promise<QueryResult>;
  update?: () => Promise<QueryResult>;
  token?: () => Promise<string>;
}): Harness {
  const calls: string[] = [];
  const sent: { chatGuid: string; text: string }[] = [];
  const session = {
    token: async () => {
      calls.push("token");
      return (opts.token ?? (async () => "jwt"))();
    },
    db: {
      from: () => {
        calls.push("query");
        return new FakeQuery((op) =>
          op === "select" ? opts.select() : (opts.update ?? (async () => ({ data: [], error: null })))(),
        );
      },
    },
  } as unknown as AgentSession;

  const poller = new ReminderPoller(
    session,
    async (chatGuid, text) => {
      sent.push({ chatGuid, text });
    },
    30_000,
  );

  const logged = { error: [] as string[], log: [] as string[] };
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (...args: unknown[]) => logged.error.push(args.join(" "));
  console.log = (...args: unknown[]) => logged.log.push(args.join(" "));

  return {
    poller,
    calls,
    sent,
    logged,
    restore: () => {
      console.error = originalError;
      console.log = originalLog;
    },
  };
}

test("poll refreshes the agent session before querying", async () => {
  const h = makeHarness({ select: async () => ({ data: [], error: null }) });
  try {
    await h.poller.poll();
  } finally {
    h.restore();
  }
  assert.deepEqual(h.calls.slice(0, 2), ["token", "query"]);
});

test("a failed session refresh skips the query and is handled", async () => {
  const h = makeHarness({
    select: async () => ({ data: [], error: null }),
    token: async () => {
      throw new Error("fetch failed");
    },
  });
  try {
    await h.poller.poll();
  } finally {
    h.restore();
  }
  assert.equal(h.calls.includes("query"), false);
  assert.equal(h.logged.error.length, 1);
});

test("repeated identical failures log once, and recovery logs once", async () => {
  let failures = 3;
  const h = makeHarness({
    select: async () =>
      failures-- > 0 ? { data: null, error: { message: "TypeError: fetch failed" } } : { data: [], error: null },
  });
  try {
    await h.poller.poll();
    await h.poller.poll();
    await h.poller.poll();
    await h.poller.poll(); // recovers
    await h.poller.poll(); // healthy again — no more logs
  } finally {
    h.restore();
  }
  const failureLines = h.logged.error.filter((l) => l.includes("fetch failed"));
  assert.equal(failureLines.length, 1);
  const recoveryLines = h.logged.log.filter((l) => l.includes("recovered"));
  assert.equal(recoveryLines.length, 1);
});

test("a failed mark-sent never re-sends the reminder — only the update is retried", async () => {
  let updateAttempts = 0;
  const h = makeHarness({
    select: async () => ({
      data: [{ id: "r1", message: "Take out the trash", channel: { chat_guid: "iMessage;+;chat-1" } }],
      error: null,
    }),
    update: async () => {
      updateAttempts++;
      return updateAttempts === 1 ? { data: null, error: { message: "fetch failed" } } : { data: [], error: null };
    },
  });
  try {
    await h.poller.poll(); // sends, but mark-sent fails
    await h.poller.poll(); // must NOT send again; retries the update
  } finally {
    h.restore();
  }
  assert.equal(h.sent.length, 1);
  assert.equal(updateAttempts, 2);
  assert.equal(
    h.logged.log.some((l) => l.includes("delivered r1")),
    true,
  );
});

test("due reminders are sent and marked sent", async () => {
  const updates: string[] = [];
  const h = makeHarness({
    select: async () => ({
      data: [{ id: "r1", message: "Take out the trash", channel: { chat_guid: "iMessage;+;chat-1" } }],
      error: null,
    }),
    update: async () => {
      updates.push("update");
      return { data: [], error: null };
    },
  });
  try {
    await h.poller.poll();
  } finally {
    h.restore();
  }
  assert.deepEqual(h.sent, [{ chatGuid: "iMessage;+;chat-1", text: "⏰ Take out the trash" }]);
  assert.equal(updates.length, 1);
  assert.equal(
    h.logged.log.some((l) => l.includes("delivered r1")),
    true,
  );
});
