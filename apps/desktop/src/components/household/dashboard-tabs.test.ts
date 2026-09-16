import { describe, expect, test } from "bun:test";
import { DASHBOARD_TABS, isDashboardTab, isMoreTab } from "./dashboard-tabs";

describe("dashboard tabs", () => {
  test("covers every household surface", () => {
    expect([...DASHBOARD_TABS]).toEqual([
      "overview",
      "chat",
      "tasks",
      "lists",
      "calendar",
      "reminders",
      "connections",
      "settings",
    ]);
  });

  test("accepts known tab ids only", () => {
    expect(isDashboardTab("overview")).toBe(true);
    expect(isDashboardTab("tasks")).toBe(true);
    expect(isDashboardTab("todos")).toBe(false);
    expect(isDashboardTab("more")).toBe(false);
  });
});

describe("mobile more sheet", () => {
  test("routes secondary destinations through More", () => {
    expect(isMoreTab("lists")).toBe(true);
    expect(isMoreTab("reminders")).toBe(true);
    expect(isMoreTab("connections")).toBe(true);
    expect(isMoreTab("settings")).toBe(true);
    expect(isMoreTab("overview")).toBe(false);
    expect(isMoreTab("chat")).toBe(false);
    expect(isMoreTab("tasks")).toBe(false);
    expect(isMoreTab("calendar")).toBe(false);
  });
});
