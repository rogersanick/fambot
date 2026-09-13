import { DateTime } from "luxon";
import { RRule } from "rrule";

/**
 * Deterministic date/recurrence resolution. The model proposes local
 * wall-clock strings; this layer owns timezones and DST. Server timezone is
 * never assumed.
 */

/** "2026-09-09T08:00[:00]" in `tz` → real UTC instant. Throws on invalid. */
export function resolveLocalDateTime(local: string, tz: string): Date {
  const dt = DateTime.fromISO(local, { zone: tz });
  if (!dt.isValid) throw new ResolutionError(`invalid datetime "${local}": ${dt.invalidReason}`);
  return dt.toJSDate();
}

/** UTC instant → local wall-clock ISO (no offset) in `tz`. */
export function toLocalIso(instant: Date, tz: string): string {
  return DateTime.fromJSDate(instant, { zone: tz }).toFormat("yyyy-MM-dd'T'HH:mm:ss");
}

export function formatLocal(instant: Date, tz: string): string {
  return DateTime.fromJSDate(instant, { zone: tz }).toFormat("ccc MMM d 'at' h:mm a");
}

/** Validate an RRULE string; throws ResolutionError when unparseable. */
export function validateRRule(rrule: string): void {
  try {
    RRule.fromString(rrule.replace(/^RRULE:/i, ""));
  } catch (err) {
    throw new ResolutionError(`invalid recurrence rule "${rrule}"`);
  }
}

/**
 * Next occurrence strictly after `after` for a recurrence anchored at
 * `anchor` (both UTC instants), computed in local wall-clock space so DST
 * transitions keep the intended local time.
 */
export function nextOccurrence(
  rruleStr: string,
  tz: string,
  anchor: Date,
  after: Date
): Date | null {
  const clean = rruleStr.replace(/^RRULE:/i, "");
  const anchorFloating = instantToFloating(anchor, tz);
  const rule = new RRule({
    ...RRule.parseString(clean),
    dtstart: anchorFloating,
  });
  const afterFloating = instantToFloating(after, tz);
  const next = rule.after(afterFloating, false);
  if (!next) return null;
  return floatingToInstant(next, tz);
}

/**
 * All occurrences within [rangeStart, rangeEnd] (inclusive) for a recurrence
 * anchored at `anchor`, DST-safe like nextOccurrence. Capped at `limit` so a
 * perpetual rule over a huge range can't blow up.
 */
export function occurrencesBetween(
  rruleStr: string,
  tz: string,
  anchor: Date,
  rangeStart: Date,
  rangeEnd: Date,
  limit = 100
): Date[] {
  const clean = rruleStr.replace(/^RRULE:/i, "");
  const rule = new RRule({
    ...RRule.parseString(clean),
    dtstart: instantToFloating(anchor, tz),
  });
  return rule
    .between(instantToFloating(rangeStart, tz), instantToFloating(rangeEnd, tz), true)
    .slice(0, limit)
    .map((d) => floatingToInstant(d, tz));
}

/** UTC instant → "floating" Date whose UTC fields equal the local wall clock in tz. */
function instantToFloating(instant: Date, tz: string): Date {
  const dt = DateTime.fromJSDate(instant, { zone: tz });
  return new Date(Date.UTC(dt.year, dt.month - 1, dt.day, dt.hour, dt.minute, dt.second));
}

/** Floating Date (UTC fields = local wall clock) → real UTC instant in tz. */
function floatingToInstant(floating: Date, tz: string): Date {
  const dt = DateTime.fromObject(
    {
      year: floating.getUTCFullYear(),
      month: floating.getUTCMonth() + 1,
      day: floating.getUTCDate(),
      hour: floating.getUTCHours(),
      minute: floating.getUTCMinutes(),
      second: floating.getUTCSeconds(),
    },
    { zone: tz }
  );
  return dt.toJSDate();
}

/**
 * Resolve a person reference against conversation participants first, then
 * the whole household (design doc §11). Case-insensitive prefix match.
 */
export function resolvePersonName<T extends { id: string; displayName: string }>(
  name: string,
  participants: T[],
  householdMembers: T[]
): T | null {
  const needle = name.trim().toLowerCase();
  const match = (pool: T[]) =>
    pool.find((m) => m.displayName.toLowerCase() === needle) ??
    pool.find((m) => m.displayName.toLowerCase().startsWith(needle));
  return match(participants) ?? match(householdMembers) ?? null;
}

export class ResolutionError extends Error {}
