import type { BridgeConfig } from "./config.js";
import type { Spool } from "./spool.js";
import type { FambotApi } from "./fambot-api.js";
import type { ImsgRpc } from "./imsg-rpc.js";

const BURST_INTERVAL_MS = 1_000;
const BURST_DURATION_MS = 15_000;
const IDLE_INTERVAL_MS = 15_000;
const MAX_BACKOFF_MS = 60_000;

/**
 * Adaptive outbox polling: 1s burst for 15s after we forward an invocation
 * (a reply is probably imminent), 15s when idle, exponential backoff to 60s
 * on failure. Batch 10, 60s lease, acknowledge after send.
 */
export class OutboxPoller {
  private burstUntil = 0;
  private failureBackoffMs = 0;
  private timer: NodeJS.Timeout | null = null;
  private polling = false;
  private stopped = false;

  constructor(
    private readonly config: BridgeConfig,
    private readonly api: FambotApi,
    private readonly rpc: ImsgRpc,
    private readonly spool: Spool,
  ) {}

  start(): void {
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  /** Called when an invocation was just forwarded — a reply is coming. */
  burst(): void {
    this.burstUntil = Date.now() + BURST_DURATION_MS;
    this.schedule(0);
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.poll(), delayMs);
  }

  private nextDelay(): number {
    if (this.failureBackoffMs > 0) return this.failureBackoffMs;
    return Date.now() < this.burstUntil ? BURST_INTERVAL_MS : IDLE_INTERVAL_MS;
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const { messages } = await this.api.pullOutbox(10);
      this.failureBackoffMs = 0;

      if (messages.length > 0) {
        const results: { id: string; status: "sent" | "failed"; error?: string }[] = [];
        for (const msg of messages) {
          try {
            const text =
              this.config.profile === "local-dev"
                ? `${this.config.botMessagePrefix}\n${msg.message_text}`
                : msg.message_text;
            const sent = await this.rpc.send({ chat_guid: msg.chat_guid, text });
            // guid is best-effort; the prefix check is the primary self-message
            // guard in local-dev, so a missing ledger entry is acceptable.
            if (sent.guid) this.spool.recordSent(sent.guid, msg.chat_guid);
            results.push({ id: msg.id, status: "sent" });
            console.log(`[outbox] sent ${msg.message_type} to ${msg.chat_guid}`);
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            results.push({ id: msg.id, status: "failed", error });
            console.error(`[outbox] send failed for ${msg.id}:`, error);
          }
        }
        await this.api.acknowledgeOutbox(results);
        // Keep polling promptly while messages are flowing.
        this.burstUntil = Math.max(this.burstUntil, Date.now() + 5_000);
      }
    } catch (err) {
      this.failureBackoffMs = Math.min(
        this.failureBackoffMs === 0 ? 2_000 : this.failureBackoffMs * 2,
        MAX_BACKOFF_MS,
      );
      console.error(
        `[outbox] pull failed, backing off ${this.failureBackoffMs}ms:`,
        err instanceof Error ? err.message : err,
      );
    } finally {
      this.polling = false;
      this.schedule(this.nextDelay());
    }
  }
}
