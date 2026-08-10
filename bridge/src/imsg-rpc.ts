import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";

/** Message notification payload from `watch.subscribe` (fields we consume). */
export interface ImsgMessage {
  /** chat.db rowid — the watch cursor. */
  id: number;
  chat_id: number;
  chat_guid?: string;
  guid?: string;
  sender?: string;
  sender_name?: string;
  is_from_me?: boolean;
  text?: string;
  created_at?: string;
}

export interface ImsgChat {
  id: number;
  guid: string;
  name?: string;
  display_name?: string;
  is_group?: boolean;
  participants?: string[];
}

export interface SendResult {
  ok: boolean;
  id?: number;
  guid?: string;
}

interface JsonRpcFrame {
  jsonrpc?: string;
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface ImsgRpcOptions {
  /** Binary to spawn (invoked with the single arg `rpc`). */
  bin: string;
  /** Called for every message notification, after the cursor is persisted. */
  onMessage: (message: ImsgMessage) => void;
  /** Persisted watch cursor (max seen message rowid). */
  getCursor: () => number | null;
  setCursor: (rowid: number) => void;
  /**
   * Test seam: alternative spawn. Production uses node:child_process.spawn.
   */
  spawnFn?: (bin: string, args: string[]) => ChildProcess;
  requestTimeoutMs?: number;
  /** Backoff bounds for supervision (overridable in tests). */
  restartMinMs?: number;
  restartMaxMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_RESTART_MIN_MS = 1_000;
const DEFAULT_RESTART_MAX_MS = 30_000;

/**
 * Client + supervisor for one long-lived `imsg rpc` child speaking JSON-RPC
 * 2.0 (one JSON object per line) on stdin/stdout. On child death, all pending
 * requests reject and the child is respawned with exponential backoff; the
 * watch subscription is re-established from the persisted rowid cursor so
 * messages that arrived while the child was down are replayed, not lost.
 */
export class ImsgRpc {
  private child: ChildProcess | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private nextId = 1;
  private stopped = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private backoffMs: number;
  private readonly opts: Required<Pick<ImsgRpcOptions, "requestTimeoutMs" | "restartMinMs" | "restartMaxMs">> &
    ImsgRpcOptions;

  constructor(options: ImsgRpcOptions) {
    this.opts = {
      requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
      restartMinMs: DEFAULT_RESTART_MIN_MS,
      restartMaxMs: DEFAULT_RESTART_MAX_MS,
      ...options,
    };
    this.backoffMs = this.opts.restartMinMs;
  }

  /** Spawn the child and establish the watch subscription. */
  async start(): Promise<void> {
    this.stopped = false;
    await this.spawnAndSubscribe();
  }

  stop(): void {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.rejectAllPending(new Error("imsg rpc stopping"));
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
  }

  /** True when a child process is currently alive. */
  isRunning(): boolean {
    return this.child !== null;
  }

  async send(params: { chat_guid: string; text: string }): Promise<SendResult> {
    const res = (await this.request("send", params)) as SendResult;
    return res;
  }

  async chatsList(limit = 50): Promise<ImsgChat[]> {
    const res = (await this.request("chats.list", { limit })) as { chats?: ImsgChat[] };
    return res.chats ?? [];
  }

  // -- internals ------------------------------------------------------------

  private async spawnAndSubscribe(): Promise<void> {
    const spawnFn = this.opts.spawnFn ?? ((bin, args) => spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] }));
    const child = spawnFn(this.opts.bin, ["rpc"]);
    this.child = child;

    if (!child.stdout || !child.stdin) {
      throw new Error("imsg rpc child has no stdio pipes");
    }

    createInterface({ input: child.stdout }).on("line", (line) => this.handleLine(line));
    if (child.stderr) {
      createInterface({ input: child.stderr }).on("line", (line) => {
        if (line.trim()) console.error(`[imsg] ${line}`);
      });
    }

    child.on("error", (err) => {
      console.error("[imsg] spawn error:", err.message);
      this.handleChildDeath();
    });
    child.on("exit", (code, signal) => {
      if (!this.stopped) {
        console.error(`[imsg] child exited (code=${code} signal=${signal})`);
      }
      this.handleChildDeath();
    });

    await this.subscribe();
    this.backoffMs = this.opts.restartMinMs; // healthy subscription resets backoff
  }

  private async subscribe(): Promise<void> {
    const cursor = this.opts.getCursor();
    try {
      await this.request("watch.subscribe", cursor !== null ? { since_rowid: cursor } : {});
    } catch (err) {
      if (cursor !== null) {
        // Stale cursor (e.g. chat.db was replaced) — fall back to a fresh watch.
        console.error(
          "[imsg] subscribe with cursor failed, retrying without cursor:",
          err instanceof Error ? err.message : err,
        );
        await this.request("watch.subscribe", {});
      } else {
        throw err;
      }
    }
  }

  private handleChildDeath(): void {
    if (this.stopped) return;
    const child = this.child;
    if (!child) return; // already handled (error + exit can both fire)
    child.removeAllListeners();
    child.kill();
    this.child = null;
    this.rejectAllPending(new Error("imsg rpc child died"));

    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, this.opts.restartMaxMs);
    console.error(`[imsg] restarting in ${delay}ms`);
    this.restartTimer = setTimeout(() => {
      void this.spawnAndSubscribe().catch((err) => {
        console.error("[imsg] restart failed:", err instanceof Error ? err.message : err);
        this.handleChildDeath();
      });
    }, delay);
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let frame: JsonRpcFrame;
    try {
      frame = JSON.parse(line) as JsonRpcFrame;
    } catch {
      console.error(`[imsg] non-JSON stdout line: ${line.slice(0, 200)}`);
      return;
    }

    if (frame.id !== undefined) {
      const pending = this.pending.get(String(frame.id));
      if (!pending) return;
      this.pending.delete(String(frame.id));
      clearTimeout(pending.timer);
      if (frame.error) {
        // imsg puts the actionable text (e.g. Full Disk Access instructions)
        // in error.data — surface it instead of just "Internal error".
        const data = typeof frame.error.data === "string" ? ` — ${frame.error.data.split("\n")[0]}` : "";
        pending.reject(
          new Error(`imsg rpc error: ${frame.error.message ?? "unknown"} (${frame.error.code ?? "?"})${data}`),
        );
      } else {
        pending.resolve(frame.result);
      }
      return;
    }

    if (frame.method === "message") {
      const params = frame.params as { message?: ImsgMessage } | undefined;
      const message = params?.message;
      if (!message || typeof message.id !== "number") return;
      const cursor = this.opts.getCursor();
      if (cursor === null || message.id > cursor) this.opts.setCursor(message.id);
      try {
        this.opts.onMessage(message);
      } catch (err) {
        console.error("[imsg] onMessage handler failed:", err instanceof Error ? err.message : err);
      }
      return;
    }

    if (frame.method === "watch.overflow") {
      // Terminal notification: the subscription's buffer overflowed and the
      // stream has ended. Resume from the documented cursor — it is at or
      // before the first dropped message, so nothing is skipped (duplicates
      // are filtered downstream by the sent ledger / idempotent handling).
      const params = frame.params as { resume_after_rowid?: number; terminal?: boolean } | undefined;
      if (typeof params?.resume_after_rowid === "number") {
        this.opts.setCursor(params.resume_after_rowid);
      }
      console.error("[imsg] watch overflow — resubscribing from cursor");
      void this.subscribe().catch((err) => {
        console.error("[imsg] resubscribe after overflow failed:", err instanceof Error ? err.message : err);
        this.handleChildDeath(); // full restart as a fallback
      });
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    const child = this.child;
    if (!child?.stdin || child.stdin.destroyed) {
      return Promise.reject(new Error("imsg rpc child is not running"));
    }
    const id = String(this.nextId++);
    const frame = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`imsg rpc request timed out: ${method}`));
      }, this.opts.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      child.stdin!.write(frame + "\n", (err) => {
        if (err) {
          const pending = this.pending.get(id);
          if (pending) {
            this.pending.delete(id);
            clearTimeout(pending.timer);
            pending.reject(err);
          }
        }
      });
    });
  }

  private rejectAllPending(err: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }
}
