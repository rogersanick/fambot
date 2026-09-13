/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { buildRRule, describeRRule } from "./recurrence";

describe("buildRRule", () => {
  test("forever is the default (no COUNT/UNTIL)", () => {
    expect(buildRRule({ freq: "daily", interval: 1, byDays: [], end: { type: "forever" } })).toBe(
      "FREQ=DAILY"
    );
  });

  test("weekly with day toggles", () => {
    expect(
      buildRRule({ freq: "weekly", interval: 1, byDays: ["MO", "WE"], end: { type: "forever" } })
    ).toBe("FREQ=WEEKLY;BYDAY=MO,WE");
  });

  test("interval > 1 is emitted", () => {
    expect(buildRRule({ freq: "weekly", interval: 2, byDays: [], end: { type: "forever" } })).toBe(
      "FREQ=WEEKLY;INTERVAL=2"
    );
  });

  test("after-N-times uses COUNT", () => {
    expect(
      buildRRule({ freq: "monthly", interval: 1, byDays: [], end: { type: "count", count: 6 } })
    ).toBe("FREQ=MONTHLY;COUNT=6");
  });

  test("until-date uses end-of-day UNTIL", () => {
    expect(
      buildRRule({ freq: "daily", interval: 1, byDays: [], end: { type: "until", date: "2026-12-31" } })
    ).toBe("FREQ=DAILY;UNTIL=20261231T235959");
  });

  test("byDays only applies to weekly", () => {
    expect(
      buildRRule({ freq: "daily", interval: 1, byDays: ["MO"], end: { type: "forever" } })
    ).toBe("FREQ=DAILY");
  });
});

describe("describeRRule", () => {
  test("simple frequencies", () => {
    expect(describeRRule("FREQ=DAILY")).toBe("every day");
    expect(describeRRule("FREQ=WEEKLY")).toBe("every week");
    expect(describeRRule("FREQ=MONTHLY")).toBe("every month");
  });

  test("weekly days and intervals", () => {
    expect(describeRRule("FREQ=WEEKLY;BYDAY=SU")).toBe("every week on Sun");
    expect(describeRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE")).toBe(
      "every 2 weeks on Mon, Wed"
    );
  });

  test("end conditions", () => {
    expect(describeRRule("FREQ=DAILY;COUNT=5")).toBe("every day, 5×");
    expect(describeRRule("FREQ=DAILY;UNTIL=20261231T235959")).toBe(
      "every day, until Dec 31, 2026"
    );
  });

  test("tolerates an RRULE: prefix and unknown rules", () => {
    expect(describeRRule("RRULE:FREQ=DAILY")).toBe("every day");
    expect(describeRRule("FREQ=SOMETIMES")).toBe("repeats");
  });
});
