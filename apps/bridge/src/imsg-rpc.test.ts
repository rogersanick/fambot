import { test } from "bun:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { ImsgRpc, type ImsgMessage } from "./imsg-rpc.js";

interface JsonRpcRequest {
  jsonrpc: string;
  id: string;
  method: string;
  params: Record<string, unknown>;
}

/** In-memory stand-in for the `imsg rpc` child process. */
class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  killed = false;
  requests: JsonRpcRequest[] = [];
  /** Per-method auto-responder; return value is sent as the JSON-RPC result. */
  handlers = new Map<string, (req: JsonRpcRequest) => void>();

  constructor() {
    super();
    let buffer = "";
    this.stdin.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        const req = JSON.parse(line) as JsonRpcRequest;
        this.requests.push(req);
        this.handlers.get(req.method)?.(req);
      }
    });
  }

  respond(id: string, result: unknown): void {
    this.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
  }

  respondError(id: string, message: string): void {
    this.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32602, message } }) + "\n");
  }

  notify(message: Partial<ImsgMessage>): void {
    this.stdout.write(
      JSON.stringify({ jsonrpc: "2.0", method: "message", params: { subscription: 1, message } }) + "\n",
    );
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }

  /** Simulate the process dying. */
  die(code = 1): void {
    this.emit("exit", code, null);
  }
}

function autoSubscribe(child: FakeChild): void {
  child.handlers.set("watch.subscribe", (req) => child.respond(req.id, { subscription: 1 }));
}

async function until(cond: () => boolean, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
}

interface Harness {
  rpc: ImsgRpc;
  spawned: FakeChild[];
  messages: ImsgMessage[];
  cursor: { value: number | null };
}

function makeHarness(opts?: { cursor?: number | null; onSpawn?: (child: FakeChild) => void }): Harness {
  const spawned: FakeChild[] = [];
  const messages: ImsgMessage[] = [];
  const cursor = { value: opts?.cursor ?? null };
  const rpc = new ImsgRpc({
    bin: "imsg",
    onMessage: (m) => messages.push(m),
    getCursor: () => cursor.value,
    setCursor: (n) => (cursor.value = n),
    spawnFn: () => {
      const child = new FakeChild();
      spawned.push(child);
      (opts?.onSpawn ?? autoSubscribe)(child);
      return child as unknown as ChildProcess;
    },
    requestTimeoutMs: 1_000,
    restartMinMs: 10,
    restartMaxMs: 40,
  });
  return { rpc, spawned, messages, cursor };
}

test("request/response correlation and typed methods", async () => {
  const h = makeHarness();
  await h.rpc.start();
  const child = h.spawned[0]!;

  child.handlers.set("chats.list", (req) => {
    assert.equal(req.params.limit, 5);
    child.respond(req.id, { chats: [{ id: 1, guid: "iMessage;+;chat-x", participants: ["+15551234567"] }] });
  });
  child.handlers.set("send", (req) => {
    assert.deepEqual(req.params, { chat_guid: "iMessage;+;chat-x", text: "hi" });
    child.respond(req.id, { ok: true, id: 42, guid: "SENT-GUID" });
  });

  const chats = await h.rpc.chatsList(5);
  assert.equal(chats.length, 1);
  assert.equal(chats[0]!.guid, "iMessage;+;chat-x");

  const sent = await h.rpc.send({ chat_guid: "iMessage;+;chat-x", text: "hi" });
  assert.equal(sent.guid, "SENT-GUID");

  // Subscribe happened exactly once, without a cursor on first run.
  const subs = child.requests.filter((r) => r.method === "watch.subscribe");
  assert.equal(subs.length, 1);
  assert.equal("since_rowid" in subs[0]!.params, false);

  h.rpc.stop();
});

test("message notifications reach the handler and advance the cursor monotonically", async () => {
  const h = makeHarness();
  await h.rpc.start();
  const child = h.spawned[0]!;

  child.notify({ id: 5, chat_id: 1, chat_guid: "g", guid: "m5", text: "hello" });
  child.notify({ id: 3, chat_id: 1, chat_guid: "g", guid: "m3", text: "older" });
  await until(() => h.messages.length === 2);

  assert.equal(h.messages[0]!.guid, "m5");
  assert.equal(h.messages[1]!.guid, "m3");
  assert.equal(h.cursor.value, 5); // never moves backwards

  h.rpc.stop();
});

test("child death rejects pending requests, restarts, and resubscribes from the cursor", async () => {
  const h = makeHarness({ cursor: null });
  await h.rpc.start();
  const child0 = h.spawned[0]!;

  child0.notify({ id: 7, chat_id: 1, chat_guid: "g", guid: "m7", text: "x" });
  await until(() => h.cursor.value === 7);

  // A request in flight when the child dies must reject.
  const inflight = h.rpc.chatsList(1);
  child0.die();
  await assert.rejects(inflight, /died/);

  // Supervisor respawns and resubscribes with the persisted cursor.
  await until(() => h.spawned.length === 2);
  const child1 = h.spawned[1]!;
  await until(() => child1.requests.some((r) => r.method === "watch.subscribe"));
  const sub = child1.requests.find((r) => r.method === "watch.subscribe")!;
  assert.equal(sub.params.since_rowid, 7);

  // New child works: notifications flow again.
  child1.notify({ id: 9, chat_id: 1, chat_guid: "g", guid: "m9", text: "y" });
  await until(() => h.messages.length === 2);

  h.rpc.stop();
});

test("stale cursor falls back to a fresh watch subscription", async () => {
  const h = makeHarness({
    cursor: 999,
    onSpawn: (child) => {
      child.handlers.set("watch.subscribe", (req) => {
        if ("since_rowid" in req.params) child.respondError(req.id, "invalid params");
        else child.respond(req.id, { subscription: 1 });
      });
    },
  });
  await h.rpc.start();

  const subs = h.spawned[0]!.requests.filter((r) => r.method === "watch.subscribe");
  assert.equal(subs.length, 2);
  assert.equal(subs[0]!.params.since_rowid, 999);
  assert.equal("since_rowid" in subs[1]!.params, false);

  h.rpc.stop();
});

test("watch.overflow advances the cursor and resubscribes on the same child", async () => {
  const h = makeHarness();
  await h.rpc.start();
  const child = h.spawned[0]!;

  child.notify({ id: 100, chat_id: 1, chat_guid: "g", guid: "m100", text: "x" });
  await until(() => h.cursor.value === 100);

  // Terminal overflow notification per docs/rpc.md: the stream has ended and
  // the client must resume from resume_after_rowid.
  child.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      method: "watch.overflow",
      params: { subscription: 1, resume_after_rowid: 9000, reason: "buffer_limit_exceeded", terminal: true },
    }) + "\n",
  );

  await until(() => child.requests.filter((r) => r.method === "watch.subscribe").length === 2);
  const resub = child.requests.filter((r) => r.method === "watch.subscribe")[1]!;
  assert.equal(resub.params.since_rowid, 9000);
  assert.equal(h.cursor.value, 9000);
  assert.equal(h.spawned.length, 1); // no restart needed

  // Stream works again after resubscribe.
  child.notify({ id: 9001, chat_id: 1, chat_guid: "g", guid: "m9001", text: "y" });
  await until(() => h.messages.length === 2);

  h.rpc.stop();
});

test("rpc errors surface the actionable data field", async () => {
  const h = makeHarness();
  await h.rpc.start();
  const child = h.spawned[0]!;

  child.handlers.set("chats.list", (req) => {
    child.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: req.id,
        error: {
          code: -32603,
          message: "Internal error",
          data: "authorization denied (code: 23)\n\n⚠️  Permission Error: Cannot access Messages database",
        },
      }) + "\n",
    );
  });

  await assert.rejects(h.rpc.chatsList(1), /authorization denied/);
  h.rpc.stop();
});

test("database unavailable errors explain Full Disk Access", async () => {
  const h = makeHarness();
  await h.rpc.start();
  const child = h.spawned[0]!;

  child.handlers.set("chats.list", (req) => {
    child.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32002, message: "Database unavailable" },
      }) + "\n",
    );
  });

  await assert.rejects(
    h.rpc.chatsList(1),
    /Grant Full Disk Access to the app running the bridge.*Cursor/
  );
  h.rpc.stop();
});

test("known-harmless macOS Contacts stderr noise is filtered from the log", async () => {
  const h = makeHarness();
  await h.rpc.start();
  const child = h.spawned[0]!;

  const logged: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => logged.push(args.join(" "));
  try {
    child.stderr.write(
      "2026-08-10 05:00:28.014 imsg[41098:1149174] Could not fetch group for change type 1 with identifier FE49568C-D758-4C1D-B38A-5C0CD0FDFC54:ABGroup, making it a delete change type.\n",
    );
    child.stderr.write("something actually important\n");
    await until(() => logged.some((l) => l.includes("something actually important")));
  } finally {
    console.error = original;
  }
  assert.equal(
    logged.some((l) => l.includes("ABGroup")),
    false,
  );
  h.rpc.stop();
});

test("stop() kills the child and does not restart", async () => {
  const h = makeHarness();
  await h.rpc.start();
  h.rpc.stop();
  assert.equal(h.spawned[0]!.killed, true);
  await new Promise((r) => setTimeout(r, 60)); // longer than restartMaxMs
  assert.equal(h.spawned.length, 1);
});
