/**
 * RRULE construction and display for the recurrence picker. Pure string
 * logic — validation and occurrence math live on the server.
 */

export type Frequency = "daily" | "weekly" | "monthly";

export type RecurrenceEnd =
  | { type: "forever" }
  | { type: "count"; count: number }
  | { type: "until"; date: string /* YYYY-MM-DD (household-local) */ };

export type RecurrenceChoice = {
  freq: Frequency;
  /** Every N days/weeks/months. */
  interval: number;
  /** Weekly only: RFC-5545 two-letter day codes (SU..SA). Empty = anchor's weekday. */
  byDays: string[];
  end: RecurrenceEnd;
};

export const WEEKDAYS: Array<{ code: string; label: string }> = [
  { code: "SU", label: "Su" },
  { code: "MO", label: "Mo" },
  { code: "TU", label: "Tu" },
  { code: "WE", label: "We" },
  { code: "TH", label: "Th" },
  { code: "FR", label: "Fr" },
  { code: "SA", label: "Sa" },
];

const DAY_NAMES: Record<string, string> = {
  SU: "Sun",
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
};

/** Build an RFC-5545 RRULE string. No COUNT/UNTIL = repeats forever. */
export function buildRRule(choice: RecurrenceChoice): string {
  const parts = [`FREQ=${choice.freq.toUpperCase()}`];
  if (choice.interval > 1) parts.push(`INTERVAL=${choice.interval}`);
  if (choice.freq === "weekly" && choice.byDays.length > 0) {
    parts.push(`BYDAY=${choice.byDays.join(",")}`);
  }
  if (choice.end.type === "count") parts.push(`COUNT=${Math.max(1, choice.end.count)}`);
  if (choice.end.type === "until") {
    // End of the chosen local day; the server treats RRULE datetimes as
    // wall-clock in the item's timezone.
    parts.push(`UNTIL=${choice.end.date.replaceAll("-", "")}T235959`);
  }
  return parts.join(";");
}

/** Human-readable summary of an RRULE, e.g. "every week on Sun, until Dec 31". */
export function describeRRule(rrule: string): string {
  const fields = new Map<string, string>();
  for (const part of rrule.replace(/^RRULE:/i, "").split(";")) {
    const [k, v] = part.split("=");
    if (k && v) fields.set(k.toUpperCase(), v);
  }
  const freq = fields.get("FREQ")?.toUpperCase();
  const interval = Number(fields.get("INTERVAL") ?? 1);

  let base: string;
  switch (freq) {
    case "DAILY":
      base = interval > 1 ? `every ${interval} days` : "every day";
      break;
    case "WEEKLY": {
      base = interval > 1 ? `every ${interval} weeks` : "every week";
      const byDay = fields.get("BYDAY");
      if (byDay) {
        const names = byDay
          .split(",")
          .map((d) => DAY_NAMES[d.replace(/^[+-]?\d+/, "")] ?? d)
          .join(", ");
        base += ` on ${names}`;
      }
      break;
    }
    case "MONTHLY":
      base = interval > 1 ? `every ${interval} months` : "every month";
      break;
    case "YEARLY":
      base = interval > 1 ? `every ${interval} years` : "every year";
      break;
    default:
      return "repeats";
  }

  const count = fields.get("COUNT");
  if (count) return `${base}, ${count}×`;
  const until = fields.get("UNTIL");
  if (until) {
    const m = until.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      return `${base}, until ${label}`;
    }
  }
  return base;
}
