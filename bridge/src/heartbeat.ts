import { release } from "node:os";
import type { BridgeConfig } from "./config.js";
import type { FambotApi } from "./fambot-api.js";
import type { InvocationMatcher } from "./invocation.js";
import type { Spool } from "./spool.js";

const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Every 60s: report liveness and pull the `chat_guid → invocation_name` map
 * so custom bot names take effect within one heartbeat. Also runs the spool
 * retention sweep.
 */
export class Heartbeat {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: BridgeConfig,
    private readonly api: FambotApi,
    private readonly matcher: InvocationMatcher,
    private readonly spool: Spool,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.beat(), HEARTBEAT_INTERVAL_MS);
    void this.beat();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async beat(): Promise<void> {
    try {
      const res = await this.api.heartbeat({
        worker_version: this.config.workerVersion,
        macos_version: release(),
      });
      this.matcher.updateMap(res.invocation_map ?? {});
      this.spool.cleanup();
    } catch (err) {
      console.error("[heartbeat] failed:", err instanceof Error ? err.message : err);
    }
  }
}
