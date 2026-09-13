import { describe, expect, test } from "bun:test";
import {
  nextOccurrence,
  occurrencesBetween,
  resolveLocalDateTime,
  resolvePersonName,
  ResolutionError,
  toLocalIso,
  validateRRule,
} from "./resolution";

const NY = "America/New_York";

describe("resolveLocalDateTime", () => {
  test("applies the household timezone (EDT)", () => {
    const d = resolveLocalDateTime("2026-09-09T08:00:00", NY);
    expect(d.toISOString()).toBe("2026-09-09T12:00:00.000Z"); // UTC-4
  });

  test("winter time uses EST", () => {
    const d = resolveLocalDateTime("2026-12-09T08:00:00", NY);
    expect(d.toISOString()).toBe("2026-12-09T13:00:00.000Z"); // UTC-5
  });

  test("throws ResolutionError on garbage", () => {
    expect(() => resolveLocalDateTime("not-a-date", NY)).toThrow(ResolutionError);
  });
});

describe("nextOccurrence", () => {
  test("weekly Sunday 19:00 stays at local 19:00 across DST", () => {
    // Anchor: Sunday Oct 25 2026, 19:00 EDT. DST ends Nov 1 2026.
    const anchor = resolveLocalDateTime("2026-10-25T19:00:00", NY);
    const after = resolveLocalDateTime("2026-10-26T00:00:00", NY);
    const next = nextOccurrence("FREQ=WEEKLY;BYDAY=SU", NY, anchor, after);
    expect(next).not.toBeNull();
    // Nov 1 2026 19:00 EST — wall clock preserved even though UTC offset changed
    expect(toLocalIso(next!, NY)).toBe("2026-11-01T19:00:00");
    expect(next!.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });

  test("COUNT-limited rules return null when exhausted", () => {
    const anchor = resolveLocalDateTime("2026-09-01T09:00:00", NY);
    const after = resolveLocalDateTime("2026-09-20T09:00:00", NY);
    expect(nextOccurrence("FREQ=DAILY;COUNT=3", NY, anchor, after)).toBeNull();
  });

  test("accepts an RRULE: prefix", () => {
    const anchor = resolveLocalDateTime("2026-09-08T09:00:00", NY);
    const next = nextOccurrence("RRULE:FREQ=DAILY", NY, anchor, anchor);
    expect(toLocalIso(next!, NY)).toBe("2026-09-09T09:00:00");
  });
});

describe("occurrencesBetween", () => {
  test("perpetual daily rule expands within the range only", () => {
    const anchor = resolveLocalDateTime("2026-09-01T09:00:00", NY);
    const start = resolveLocalDateTime("2026-09-10T00:00:00", NY);
    const end = resolveLocalDateTime("2026-09-12T23:59:00", NY);
    const got = occurrencesBetween("FREQ=DAILY", NY, anchor, start, end);
    expect(got.map((d) => toLocalIso(d, NY))).toEqual([
      "2026-09-10T09:00:00",
      "2026-09-11T09:00:00",
      "2026-09-12T09:00:00",
    ]);
  });

  test("COUNT limits the run", () => {
    const anchor = resolveLocalDateTime("2026-09-01T09:00:00", NY);
    const start = resolveLocalDateTime("2026-08-01T00:00:00", NY);
    const end = resolveLocalDateTime("2026-10-01T00:00:00", NY);
    const got = occurrencesBetween("FREQ=DAILY;COUNT=3", NY, anchor, start, end);
    expect(got).toHaveLength(3);
    expect(toLocalIso(got[2]!, NY)).toBe("2026-09-03T09:00:00");
  });

  test("UNTIL bounds the run", () => {
    const anchor = resolveLocalDateTime("2026-09-01T09:00:00", NY);
    const start = resolveLocalDateTime("2026-08-01T00:00:00", NY);
    const end = resolveLocalDateTime("2026-12-01T00:00:00", NY);
    const got = occurrencesBetween("FREQ=WEEKLY;UNTIL=20260930T235959", NY, anchor, start, end);
    expect(got.map((d) => toLocalIso(d, NY))).toEqual([
      "2026-09-01T09:00:00",
      "2026-09-08T09:00:00",
      "2026-09-15T09:00:00",
      "2026-09-22T09:00:00",
      "2026-09-29T09:00:00",
    ]);
  });

  test("keeps local wall-clock across the DST boundary", () => {
    // DST ends Nov 1 2026 in America/New_York.
    const anchor = resolveLocalDateTime("2026-10-30T08:00:00", NY);
    const start = anchor;
    const end = resolveLocalDateTime("2026-11-02T23:00:00", NY);
    const got = occurrencesBetween("FREQ=DAILY", NY, anchor, start, end);
    expect(got.map((d) => toLocalIso(d, NY))).toEqual([
      "2026-10-30T08:00:00",
      "2026-10-31T08:00:00",
      "2026-11-01T08:00:00",
      "2026-11-02T08:00:00",
    ]);
    // Offsets differ around the transition: EDT (UTC-4) → EST (UTC-5).
    expect(got[1]!.toISOString()).toBe("2026-10-31T12:00:00.000Z");
    expect(got[2]!.toISOString()).toBe("2026-11-01T13:00:00.000Z");
  });

  test("respects the safety limit", () => {
    const anchor = resolveLocalDateTime("2026-01-01T09:00:00", NY);
    const start = anchor;
    const end = resolveLocalDateTime("2027-01-01T09:00:00", NY);
    expect(occurrencesBetween("FREQ=DAILY", NY, anchor, start, end, 10)).toHaveLength(10);
  });
});

describe("validateRRule", () => {
  test("accepts valid, rejects invalid", () => {
    expect(() => validateRRule("FREQ=WEEKLY;BYDAY=MO")).not.toThrow();
    expect(() => validateRRule("FREQ=SOMETIMES")).toThrow(ResolutionError);
  });
});

describe("resolvePersonName", () => {
  const nick = { id: "1", displayName: "Nick" };
  const jess = { id: "2", displayName: "Jess" };
  const jessica = { id: "3", displayName: "Jessica Senior" };

  test("participants win over household", () => {
    expect(resolvePersonName("jess", [jess], [jessica, jess])).toBe(jess);
  });

  test("prefix match falls back to household", () => {
    expect(resolvePersonName("Jessi", [nick], [nick, jessica])).toBe(jessica);
  });

  test("unknown name returns null", () => {
    expect(resolvePersonName("Bob", [nick], [nick, jess])).toBeNull();
  });
});
