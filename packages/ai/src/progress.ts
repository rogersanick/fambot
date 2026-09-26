import type { AgentToolStep } from "./types";

export type ProgressReporterOptions = {
  /** Delivers one progress update to the originating channel. */
  send: (text: string) => Promise<void>;
  /** Quick runs stay silent: no update before this much elapsed time. */
  minDelayMs?: number;
  /** Hard cap per run (SMS costs money; chats hate spam). */
  maxUpdates?: number;
  /** Injectable for deterministic tests. */
  random?: () => number;
};

/** Read tools get a generic "working on it" line instead of their result. */
const READ_TOOL_TEXT = "Looking that up…";
const PROGRESS_VERBS = [
  "working",
  "cogitating",
  "thinking",
  "progressing",
  "planifying",
  "noodling",
] as const;
const READ_TOOLS = new Set([
  "get_context",
  "list_members",
  "list_lists",
  "list_tasks",
  "list_reminders",
  "list_events",
  "get_notification_channels",
  "get_list",
  "search_schedule",
  "get_comment_status",
]);

/**
 * Turns completed tool steps into safe, deduplicated progress updates.
 * Texts come only from templates and server-generated tool messages — never
 * from raw model output. Delivery failures are swallowed: progress is
 * best-effort and must never break the run.
 */
export class ProgressReporter {
  private startedAt = Date.now();
  private sent = 0;
  private lastText: string | null = null;
  private readonly minDelayMs: number;
  private readonly maxUpdates: number;
  private readonly random: () => number;

  constructor(private readonly options: ProgressReporterOptions) {
    this.minDelayMs = options.minDelayMs ?? 2_500;
    this.maxUpdates = options.maxUpdates ?? 3;
    this.random = options.random ?? Math.random;
  }

  async onToolStep(step: AgentToolStep): Promise<void> {
    if (Date.now() - this.startedAt < this.minDelayMs) return;
    if (this.sent >= this.maxUpdates) return;
    const text = progressText(step);
    if (!text || text === this.lastText) return;
    this.lastText = text;
    this.sent += 1;
    try {
      const verb = PROGRESS_VERBS[Math.floor(this.random() * PROGRESS_VERBS.length)]!;
      await this.options.send(`⏳ Fambot is ${verb}…\nProgress update: ${text}`);
    } catch {
      // best-effort
    }
  }
}

function progressText(step: AgentToolStep): string | null {
  if (step.status === "failed") return null; // the final reply explains failures
  if (READ_TOOLS.has(step.toolName)) return READ_TOOL_TEXT;
  // Mutations: the executor's own deterministic confirmation copy is safe.
  return step.message || null;
}
