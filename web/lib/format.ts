/** Household-timezone date formatting shared by portal pages. */

export function fmtWhen(iso: string | null, timeZone: string, now = new Date()): string {
  if (!iso) return "";
  const date = new Date(iso);
  const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" });
  const target = dayFmt.format(date);
  const today = dayFmt.format(now);
  const tomorrow = dayFmt.format(new Date(now.getTime() + 86400000));
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  if (target === today) return `Today, ${time}`;
  if (target === tomorrow) return `Tomorrow, ${time}`;
  return `${new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date)}, ${time}`;
}

export function fmtDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

export function fmtTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/** YYYY-MM-DD in the household timezone. */
export function localDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, dateStyle: "short" }).format(date);
}

export function isOverdue(iso: string | null, now = new Date()): boolean {
  return !!iso && new Date(iso).getTime() < now.getTime();
}
