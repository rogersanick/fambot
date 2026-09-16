import { describe, expect, test } from "bun:test";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt";
import type { AgentInput } from "./types";

const base: AgentInput = {
  nowLocal: "2026-09-13T11:00:00",
  timezone: "America/New_York",
  senderName: "Nick",
  participantNames: ["Nick"],
  isGroup: false,
  recentTurns: [],
  text: "move this to Friday",
};

describe("SYSTEM_PROMPT", () => {
  test("names native nested and dedicated link tools", () => {
    expect(SYSTEM_PROMPT).toContain("link_list_to_task");
    expect(SYSTEM_PROMPT).toContain("link_list_to_event");
    expect(SYSTEM_PROMPT).toContain("link_reminder_to_task");
    expect(SYSTEM_PROMPT).toContain("link_reminder_to_event");
    expect(SYSTEM_PROMPT).toContain("list_ref");
    expect(SYSTEM_PROMPT).toContain("notes (the description/body)");
    expect(SYSTEM_PROMPT).toContain("not the event body");
  });
});

describe("buildUserPrompt", () => {
  test("includes focused-item context when present", () => {
    const prompt = buildUserPrompt({
      ...base,
      focusedArtifact: {
        type: "task",
        id: "11111111-1111-4111-8111-111111111111",
        title: "Take out trash",
        details: "Due Fri Sep 13 at 8:00 PM · open",
      },
    });
    expect(prompt).toContain('focused item: task "Take out trash"');
    expect(prompt).toContain("Due Fri Sep 13 at 8:00 PM · open");
    expect(prompt).toContain("Prefer updating it unless they clearly ask for something else");
  });

  test("omits focused-item block when absent", () => {
    expect(buildUserPrompt(base)).not.toContain("focused item");
  });
});
