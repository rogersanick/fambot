/** Timezone-aware helpers built on Intl only (no runtime deps). */

/** Wall-clock parts of an instant in a given IANA timezone. */
export function wallClock(date: Date, timeZone: string): {
  year: number; month: number; day: number; hour: number; minute: number; weekday: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

/** UTC instant for a wall-clock date+time in a timezone (iterative offset fix). */
export function zonedDateTimeToUtc(
  y: number, m: number, d: number, hh: number, mm: number, timeZone: string,
): Date {
  let guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  for (let i = 0; i < 3; i++) {
    const wc = wallClock(guess, timeZone);
    const wantMinutes = Date.UTC(y, m - 1, d, hh, mm) / 60000;
    const haveMinutes = Date.UTC(wc.year, wc.month - 1, wc.day, wc.hour, wc.minute) / 60000;
    const diff = wantMinutes - haveMinutes;
    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff * 60000);
  }
  return guess;
}

/** Replace the time-of-day of an instant, keeping its date in the household tz. */
export function snapTimeOfDay(date: Date, timeZone: string, timeHHMM: string): Date {
  const wc = wallClock(date, timeZone);
  const [hh = 0, mm = 0] = timeHHMM.split(":").map(Number);
  return zonedDateTimeToUtc(wc.year, wc.month, wc.day, hh, mm, timeZone);
}

const NAMED_WINDOWS: { match: RegExp; key: "morning" | "afternoon" | "evening" | "tonight" | "eod" }[] = [
  { match: /\bmorning\b/i, key: "morning" },
  { match: /\bafternoon\b/i, key: "afternoon" },
  { match: /\bevening\b/i, key: "evening" },
  { match: /\btonight\b/i, key: "tonight" },
  { match: /\bend of (the )?day\b|\beod\b/i, key: "eod" },
];

/**
 * Named time windows. morning/afternoon/evening come from household settings;
 * tonight (20:00) and end of day (18:00) are fixed constants.
 * Returns the snapped instant plus a disclosure label, or null when the
 * expression names no window.
 */
export function applyNamedWindow(
  expression: string | null,
  proposed: Date,
  timeZone: string,
  defaults: { morning: string; afternoon: string; evening: string },
): { date: Date; disclosure: string } | null {
  if (!expression) return null;
  for (const { match, key } of NAMED_WINDOWS) {
    if (!match.test(expression)) continue;
    const time =
      key === "morning" ? defaults.morning :
      key === "afternoon" ? defaults.afternoon :
      key === "evening" ? defaults.evening :
      key === "tonight" ? "20:00" : "18:00";
    const label =
      key === "eod" ? "end-of-day default" :
      key === "tonight" ? "tonight default" : `${key} default`;
    return { date: snapTimeOfDay(proposed, timeZone, time.slice(0, 5)), disclosure: label };
  }
  return null;
}

/** "Today, 6:00 PM" / "Tomorrow, 9:00 AM" / "Sat, Aug 8, 6:00 PM" in household tz. */
export function formatWhen(date: Date, timeZone: string, now: Date = new Date()): string {
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" });
  const target = dayFmt.format(date);
  const today = dayFmt.format(now);
  const tomorrow = dayFmt.format(new Date(now.getTime() + 24 * 3600 * 1000));

  const time = new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "numeric", minute: "2-digit", hour12: true,
  }).format(date);

  if (target === today) return `Today, ${time}`;
  if (target === tomorrow) return `Tomorrow, ${time}`;
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone, weekday: "short", month: "short", day: "numeric",
  }).format(date);
  return `${dateLabel}, ${time}`;
}

/** YYYY-MM-DD of an instant in the household tz (for calendar deep links). */
export function localDateString(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(date);
}

export function isValidIanaTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
