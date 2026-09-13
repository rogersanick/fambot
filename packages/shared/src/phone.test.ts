import { describe, expect, test } from "bun:test";
import { formatPhone, normalizePhone } from "./phone";

describe("phone numbers", () => {
  test("adds the US country code to a 10-digit number", () => {
    expect(normalizePhone("5855551212")).toBe("+15855551212");
    expect(normalizePhone("(585) 555-1212")).toBe("+15855551212");
  });

  test("accepts existing E.164 numbers", () => {
    expect(normalizePhone("+1 (585) 555-1212")).toBe("+15855551212");
    expect(normalizePhone("+442079460018")).toBe("+442079460018");
  });

  test("rejects incomplete numbers", () => {
    expect(normalizePhone("555-1212")).toBeNull();
  });

  test("formats North American numbers for display", () => {
    expect(formatPhone("5855551212")).toBe("+1 (585) 555-1212");
  });
});
