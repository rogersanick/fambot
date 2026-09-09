import type { ProposedAction } from "@fambot/shared";
import type { AIProvider, InterpretationInput, InterpretationResult } from "./types";

/**
 * Deterministic, keyless provider used for local demos and integration tests.
 * Handles a small grammar:
 *   "remind me/us [in N minutes|tomorrow at 8am|at 5pm] to X"
 *   "make sure X [by ...]" / "task: X" (tasks)
 *   "every sunday at 7pm ..." (recurring)
 *   "done" (complete last-nudged task)
 *   "what's on today/tomorrow/this week" (search)
 * Anything else becomes a chat_reply.
 */
export class FakeAIProvider implements AIProvider {
  async interpret(input: InterpretationInput): Promise<InterpretationResult> {
    const start = Date.now();
    const actions = this.parse(input);
    return {
      actions,
      meta: {
        provider: "fake",
        model: "fake-1",
        latencyMs: Date.now() - start,
        status: "ok",
      },
    };
  }

  private parse(input: InterpretationInput): ProposedAction[] {
    const text = input.text.trim();
    const lower = text.toLowerCase();
    const now = new Date(input.nowLocal);

    // Completion confirmations
    if (/^(done|did it|finished( it)?|completed?|it'?s done)[.!]*$/i.test(lower)) {
      return [{ type: "complete_task", task_ref: null }];
    }

    // Schedule questions
    if (/\bwhat('s| is| do (i|we) have)?\b.*\b(on|happening|scheduled|calendar|today|tomorrow|week)\b/i.test(lower) || /^what('s| is) (today|tomorrow)/i.test(lower)) {
      const { start_at, end_at } = searchRange(lower, now);
      return [{ type: "search_schedule", start_at, end_at, query: null }];
    }

    // Lists
    const listMatch = lower.match(/^(?:create|make|add) (?:a )?list (?:called |named )?["']?([\w\s-]+?)["']?$/i);
    if (listMatch) return [{ type: "create_list", name: title(listMatch[1]!) }];

    // Reminders / tasks
    const remind = text.match(/remind (me|us|everyone|\w+)\b(.*)/i);
    const taskish = /\b(make sure|don'?t forget to|must|need to|have to|task)\b/i.test(lower);

    if (remind || taskish) {
      const rest = remind ? remind[2]! : text;
      const when = parseWhen(rest, now);
      const cleanedTitle = cleanTitle(rest);
      if (!cleanedTitle) {
        return [{ type: "clarify", question: "What should the reminder say?" }];
      }
      if (taskish && !remind) {
        return [
          {
            type: "create_task",
            title: cleanedTitle,
            due_at: when.at,
            rrule: when.rrule,
            nag_interval_minutes: null,
            assignee_name: null,
            list_name: null,
          },
        ];
      }
      const who = (remind?.[1] ?? "me").toLowerCase();
      const target = who === "me" ? "sender" : who === "us" || who === "everyone" ? "conversation" : "named_person";
      if (!when.at && !when.rrule) {
        return [{ type: "clarify", question: `When should I remind ${who === "me" ? "you" : who}?` }];
      }
      return [
        {
          type: "create_reminder",
          title: cleanedTitle,
          fire_at: when.at,
          rrule: when.rrule,
          target,
          target_name: target === "named_person" ? title(who) : null,
        },
      ];
    }

    // Events
    const eventMatch = text.match(/add (.+?) to (?:my |the )?calendar/i);
    if (eventMatch) {
      const when = parseWhen(text, now);
      if (!when.at) return [{ type: "clarify", question: "When is that event?" }];
      return [
        {
          type: "create_event",
          title: cleanTitle(eventMatch[1]!) || title(eventMatch[1]!),
          start_at: when.at,
          end_at: null,
          location: null,
          attendee_names: null,
        },
      ];
    }

    // Ambiguous short fragments like "dinner Friday"
    if (lower.split(/\s+/).length <= 3 && /\b(mon|tue|wed|thu|fri|sat|sun|today|tomorrow)/i.test(lower)) {
      return [
        { type: "clarify", question: `Should I add "${text}" to the calendar or set a reminder?` },
      ];
    }

    return [
      {
        type: "chat_reply",
        text: "Hi! I can set reminders (\"remind me in 10 minutes to ...\"), tasks (\"make sure ...\"), and calendar events (\"add ... to the calendar\").",
      },
    ];
  }
}

// ---------------------------------------------------------------------------

type When = { at: string | null; rrule: string | null };

const DOW: Record<string, string> = {
  sunday: "SU", monday: "MO", tuesday: "TU", wednesday: "WE",
  thursday: "TH", friday: "FR", saturday: "SA",
};

function parseWhen(text: string, now: Date): When {
  const lower = text.toLowerCase();

  // recurring: "every sunday [at 7pm]" / "every day at 9"
  const every = lower.match(/every (day|week|sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?: (?:night|morning|evening))?(?: at ([\d:apm ]+))?/);
  if (every) {
    const unit = every[1]!;
    const t = every[2] ? parseClock(every[2]!) : { h: 9, m: 0 };
    const first = nextOccurrence(now, unit === "day" || unit === "week" ? null : unit, t);
    const rrule =
      unit === "day"
        ? "FREQ=DAILY"
        : unit === "week"
          ? "FREQ=WEEKLY"
          : `FREQ=WEEKLY;BYDAY=${DOW[unit]}`;
    return { at: toLocalIso(first), rrule };
  }

  // "in N minutes/hours"
  const rel = lower.match(/in (\d+) ?(min(?:ute)?s?|hours?|hrs?)/);
  if (rel) {
    const n = parseInt(rel[1]!, 10);
    const ms = /min/.test(rel[2]!) ? n * 60_000 : n * 3_600_000;
    return { at: toLocalIso(new Date(now.getTime() + ms)), rrule: null };
  }

  // "tomorrow [morning|at 8am]"
  if (lower.includes("tomorrow")) {
    const clock = lower.match(/at ([\d:]+ ?(?:am|pm)?)/);
    const t = clock ? parseClock(clock[1]!) : lower.includes("morning") ? { h: 8, m: 0 } : { h: 9, m: 0 };
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(t.h, t.m, 0, 0);
    return { at: toLocalIso(d), rrule: null };
  }

  // "tonight"
  if (lower.includes("tonight")) {
    const d = new Date(now);
    d.setHours(20, 0, 0, 0);
    if (d <= now) d.setTime(now.getTime() + 3_600_000);
    return { at: toLocalIso(d), rrule: null };
  }

  // "on friday at 7"
  const dow = lower.match(/on (sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?: at ([\d:apm ]+))?/);
  if (dow) {
    const t = dow[2] ? parseClock(dow[2]!) : { h: 9, m: 0 };
    return { at: toLocalIso(nextOccurrence(now, dow[1]!, t)), rrule: null };
  }

  // "at 5pm" (today, or tomorrow if past)
  const clock = lower.match(/at ([\d:]+ ?(?:am|pm)?)/);
  if (clock) {
    const t = parseClock(clock[1]!);
    const d = new Date(now);
    d.setHours(t.h, t.m, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    return { at: toLocalIso(d), rrule: null };
  }

  return { at: null, rrule: null };
}

function parseClock(s: string): { h: number; m: number } {
  const m = s.trim().match(/(\d{1,2})(?::(\d{2}))? ?(am|pm)?/);
  if (!m) return { h: 9, m: 0 };
  let h = parseInt(m[1]!, 10);
  const min = m[2] ? parseInt(m[2]!, 10) : 0;
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (!m[3] && h <= 7) h += 12; // bare "at 5" biases to evening
  return { h, m: min };
}

function nextOccurrence(now: Date, dayName: string | null, t: { h: number; m: number }): Date {
  const d = new Date(now);
  d.setHours(t.h, t.m, 0, 0);
  if (dayName) {
    const target = Object.keys(DOW).indexOf(dayName);
    while (d.getDay() !== target || d <= now) d.setDate(d.getDate() + 1);
  } else if (d <= now) {
    d.setDate(d.getDate() + 1);
  }
  return d;
}

function searchRange(lower: string, now: Date): { start_at: string; end_at: string } {
  const start = new Date(now);
  const end = new Date(now);
  if (lower.includes("tomorrow")) {
    start.setDate(start.getDate() + 1);
    start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime() + 86_400_000);
  } else if (lower.includes("week")) {
    start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime() + 7 * 86_400_000);
  } else {
    start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime() + 86_400_000);
  }
  return { start_at: toLocalIso(start), end_at: toLocalIso(end) };
}

function cleanTitle(rest: string): string {
  return rest
    .replace(/\b(in \d+ ?(?:min(?:ute)?s?|hours?|hrs?))\b/gi, "")
    .replace(/\b(tomorrow|tonight|today)( (morning|night|evening|afternoon))?\b/gi, "")
    .replace(/\bevery (day|week|sunday|monday|tuesday|wednesday|thursday|friday|saturday)( (night|morning|evening))?\b/gi, "")
    .replace(/\bon (sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, "")
    .replace(/\bat [\d:]+ ?(am|pm)?\b/gi, "")
    .replace(/^\s*(to|that)\b/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function title(s: string): string {
  const t = s.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function toLocalIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:00`;
}
