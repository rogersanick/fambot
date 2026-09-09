import type { AgentSession } from "./supabase-session.js";

export interface ReminderSender {
  (chatGuid: string, text: string): Promise<void>;
}

/**
 * Polls Supabase for due reminders and delivers them over iMessage. Runs on
 * the always-on Mac; if the laptop was asleep, reminders send late on the
 * next poll rather than being lost. Failures stay `pending` and retry.
 */
export class ReminderPoller {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Last failure message, so transient outages log once instead of every poll. */
  private lastFailure: string | null = null;
  /** Sent over iMessage but not yet marked in the DB — retry the mark only, never the send. */
  private readonly awaitingMark = new Set<string>();

  constructor(
    private readonly session: AgentSession,
    private readonly send: ReminderSender,
    private readonly pollMs: number,
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.poll(), this.pollMs);
    void this.poll();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async poll(): Promise<void> {
    if (this.running) return; // no overlapping polls
    this.running = true;
    try {
      // Ensure a live session first. After a long sleep the agent's JWT is
      // expired (the auto-refresh timer slept too), and supabase-js would
      // fall back to the anon key — which has no table grants, surfacing as
      // "permission denied for table reminders".
      try {
        await this.session.token();
      } catch (err) {
        this.noteFailure(`session refresh failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      const { data, error } = await this.session.db
        .from("reminders")
        .select("id, message, channel:channels(chat_guid)")
        .eq("status", "pending")
        .lte("fire_at", new Date().toISOString())
        .not("channel_id", "is", null)
        .order("fire_at")
        .limit(10);
      if (error) {
        this.noteFailure(`query failed: ${error.message}`);
        return;
      }
      this.noteRecovery();
      for (const row of data ?? []) {
        const channel = row.channel as { chat_guid?: string } | null;
        const chatGuid = channel?.chat_guid;
        if (!chatGuid) continue;
        try {
          if (!this.awaitingMark.has(row.id)) {
            await this.send(chatGuid, `⏰ ${row.message}`);
            this.awaitingMark.add(row.id);
          }
          const { error: updateError } = await this.session.db
            .from("reminders")
            .update({ status: "sent", sent_at: new Date().toISOString() })
            .eq("id", row.id);
          if (updateError) {
            console.error("[reminders] mark-sent failed (will retry the mark):", updateError.message);
          } else {
            this.awaitingMark.delete(row.id);
            console.log(`[reminders] delivered ${row.id}`);
          }
        } catch (err) {
          console.error("[reminders] send failed (will retry):", err instanceof Error ? err.message : err);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** Logs a failure once; identical repeats (e.g. all night during sleep) are suppressed. */
  private noteFailure(message: string): void {
    if (message === this.lastFailure) return;
    this.lastFailure = message;
    console.error(`[reminders] ${message} (will keep retrying; suppressing identical repeats)`);
  }

  private noteRecovery(): void {
    if (this.lastFailure === null) return;
    this.lastFailure = null;
    console.log("[reminders] recovered — polling is healthy again");
  }
}
