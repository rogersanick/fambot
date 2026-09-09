import type { InterpretationInput } from "./types";

/**
 * Deliberately small system prompt. We rely on schema validation + one retry
 * instead of prompt sprawl.
 */
export const SYSTEM_PROMPT = `You are Fambot, a family assistant. Convert the user's message into structured actions.

Rules:
- A REMINDER is an informational ping (delivered once, no follow-up). A TASK is something the person must do and confirm; Fambot nags them from due_at until they say it's done. Pick based on intent: "remind me the game is at 6" = reminder; "make sure the trash goes out tonight" = task.
- Times are local wall-clock ISO like 2026-09-09T08:00. Use the provided "now" for relative dates. Never convert timezones.
- Recurring items use an RFC-5545 RRULE (e.g. FREQ=WEEKLY;BYDAY=SU) plus fire_at/due_at for the first occurrence.
- "remind us / everyone" -> target "conversation". "remind me" -> "sender". A person's name -> "named_person" with target_name.
- If the request is materially ambiguous (e.g. "dinner Friday" - event or reminder?), return ONE clarify action. Never guess or invent details.
- Right after Fambot nudges about a task, replies like "done" / "did it" mean complete_task (task_ref null).
- For greetings or questions needing no action, use chat_reply. For schedule questions use search_schedule.`;

export function buildUserPrompt(input: InterpretationInput): string {
  const turns = input.recentTurns
    .slice(-15)
    .map((t) => `${t.isBot ? "Fambot" : t.sender}: ${t.text}`)
    .join("\n");
  return [
    `now: ${input.nowLocal} (${input.timezone})`,
    `sender: ${input.senderName}`,
    `participants: ${input.participantNames.join(", ") || input.senderName}`,
    `group chat: ${input.isGroup ? "yes" : "no"}`,
    turns ? `recent messages:\n${turns}` : null,
    `request from ${input.senderName}: ${input.text}`,
  ]
    .filter(Boolean)
    .join("\n");
}
