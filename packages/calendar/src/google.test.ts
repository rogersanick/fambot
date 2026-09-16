import { describe, expect, test } from "bun:test";
import { buildGoogleEventPayload } from "./google";

const base = {
  title: "Soccer practice",
  startsAt: new Date("2026-09-10T21:00:00.000Z"),
  endsAt: new Date("2026-09-10T22:00:00.000Z"),
  location: "Field 3",
  notes: "Bring shin guards and water.",
  timezone: "America/New_York",
  rrule: null as string | null,
};

describe("buildGoogleEventPayload", () => {
  test("one-off event has no recurrence key", () => {
    const p = buildGoogleEventPayload(base);
    expect(p).toEqual({
      summary: "Soccer practice",
      location: "Field 3",
      description: "Bring shin guards and water.",
      start: { dateTime: "2026-09-10T21:00:00.000Z", timeZone: "America/New_York" },
      end: { dateTime: "2026-09-10T22:00:00.000Z", timeZone: "America/New_York" },
    });
    expect("recurrence" in p).toBe(false);
  });

  test("recurring event sends the whole series as RRULE", () => {
    const p = buildGoogleEventPayload({ ...base, rrule: "FREQ=WEEKLY;BYDAY=TH" });
    expect(p.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=TH"]);
  });

  test("an existing RRULE: prefix is not doubled", () => {
    const p = buildGoogleEventPayload({ ...base, rrule: "RRULE:FREQ=DAILY;COUNT=5" });
    expect(p.recurrence).toEqual(["RRULE:FREQ=DAILY;COUNT=5"]);
  });

  test("null notes omit description", () => {
    const p = buildGoogleEventPayload({ ...base, notes: null });
    expect("description" in p).toBe(false);
  });

  test("missing end defaults to one hour", () => {
    const p = buildGoogleEventPayload({ ...base, endsAt: null }) as {
      end: { dateTime: string };
    };
    expect(p.end.dateTime).toBe("2026-09-10T22:00:00.000Z");
  });
});
