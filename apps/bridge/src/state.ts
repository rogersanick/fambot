import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const SENT_CAP = 500;

/**
 * Bridge state. The watch cursor (max seen chat.db rowid) is persisted to a
 * JSON file so restarts replay missed messages. The sent-GUID set is
 * in-memory only — the message prefix is the primary self-message signal, the
 * ledger is belt-and-suspenders within one process lifetime.
 */
export class BridgeState {
  private cursor: number | null = null;
  private readonly sent = new Set<string>();

  constructor(private readonly path: string) {
    if (existsSync(path)) {
      try {
        const data = JSON.parse(readFileSync(path, "utf8")) as { cursor?: number };
        if (typeof data.cursor === "number") this.cursor = data.cursor;
      } catch {
        // Corrupt state file — start with a fresh watch.
      }
    }
  }

  getCursor(): number | null {
    return this.cursor;
  }

  setCursor(rowid: number): void {
    this.cursor = rowid;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify({ cursor: rowid }));
  }

  recordSent(guid: string | undefined): void {
    if (!guid) return;
    this.sent.add(guid);
    if (this.sent.size > SENT_CAP) {
      const first = this.sent.values().next().value;
      if (first) this.sent.delete(first);
    }
  }

  wasSentByUs(guid: string): boolean {
    return this.sent.has(guid);
  }
}
