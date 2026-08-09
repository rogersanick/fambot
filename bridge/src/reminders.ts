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
      const { data, error } = await this.session.db
        .from("reminders")
        .select("id, message, channel:channels(chat_guid)")
        .eq("status", "pending")
        .lte("fire_at", new Date().toISOString())
        .not("channel_id", "is", null)
        .limit(10);
      if (error) {
        console.error("[reminders] query failed:", error.message);
        return;
      }
      for (const row of data ?? []) {
        const channel = row.channel as { chat_guid?: string } | null;
        const chatGuid = channel?.chat_guid;
        if (!chatGuid) continue;
        try {
          await this.send(chatGuid, `⏰ ${row.message}`);
          const { error: updateError } = await this.session.db
            .from("reminders")
            .update({ status: "sent", sent_at: new Date().toISOString() })
            .eq("id", row.id);
          if (updateError) console.error("[reminders] mark-sent failed:", updateError.message);
          else console.log(`[reminders] delivered ${row.id}`);
        } catch (err) {
          console.error("[reminders] send failed (will retry):", err instanceof Error ? err.message : err);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
