import type { Spool } from "./spool.js";
import type { FambotApi, IngestPayload } from "./fambot-api.js";

/**
 * Drains the SQLite spool into `ingest-message` with exponential backoff.
 * The spool row is only marked delivered after a 2xx, so a crash between
 * webhook and forward loses nothing; the server dedupes on message GUID.
 */
export class Forwarder {
  private draining = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly spool: Spool,
    private readonly api: FambotApi,
    private readonly onForwarded: () => void,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.kick(), 15_000);
    this.kick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  kick(): void {
    if (!this.draining) void this.drain();
  }

  private async drain(): Promise<void> {
    this.draining = true;
    try {
      for (;;) {
        const row = this.spool.nextPending();
        if (!row) break;
        try {
          await this.api.ingestMessage(JSON.parse(row.payload) as IngestPayload);
          this.spool.markDelivered(row.id);
          this.onForwarded();
        } catch (err) {
          this.spool.bumpAttempts(row.id);
          const delayMs = Math.min(1000 * 2 ** row.attempts, 60_000);
          console.error(
            `[forwarder] ingest failed (attempt ${row.attempts + 1}), retrying in ${delayMs}ms:`,
            err instanceof Error ? err.message : err,
          );
          setTimeout(() => this.kick(), delayMs);
          break;
        }
      }
    } finally {
      this.draining = false;
    }
  }
}
