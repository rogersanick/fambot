export interface ContextTurn {
  messageGuid: string;
  senderHandle: string;
  senderName: string | null;
  text: string;
  sentAt: string; // ISO timestamp
  invokedBot: boolean;
  isFromMe: boolean;
  /** The bot's own reply (buffered so multi-turn flows see both sides). */
  isBot: boolean;
}

const MAX_TURNS = 8;
const MAX_AGE_MS = 10 * 60 * 1000;

/**
 * In-memory only — never written to disk. Bounded to 8 messages / 10 minutes
 * per channel. Losing it on restart is acceptable; FamBot asks for
 * clarification rather than guessing.
 */
export class ContextBuffer {
  private readonly channels = new Map<string, ContextTurn[]>();

  add(chatGuid: string, turn: ContextTurn): void {
    const list = this.channels.get(chatGuid) ?? [];
    // Bot replies are recorded at send time AND echo back via the watch
    // stream; the same GUID must not appear twice.
    if (list.some((t) => t.messageGuid === turn.messageGuid)) return;
    list.push(turn);
    this.channels.set(chatGuid, this.prune(list));
  }

  /**
   * Context for an invocation: up to the 8 most recent eligible turns from the
   * previous 10 minutes, ending with the invoking message (which the caller
   * has already added).
   */
  select(chatGuid: string): ContextTurn[] {
    const list = this.prune(this.channels.get(chatGuid) ?? []);
    this.channels.set(chatGuid, list);
    return [...list];
  }

  private prune(list: ContextTurn[]): ContextTurn[] {
    const cutoff = Date.now() - MAX_AGE_MS;
    const fresh = list.filter((t) => Date.parse(t.sentAt) >= cutoff);
    return fresh.slice(-MAX_TURNS);
  }

  /** Periodic sweep so idle channels don't hold stale turns in memory. */
  sweep(): void {
    for (const [guid, list] of this.channels) {
      const pruned = this.prune(list);
      if (pruned.length === 0) this.channels.delete(guid);
      else this.channels.set(guid, pruned);
    }
  }
}
