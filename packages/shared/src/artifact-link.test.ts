import { describe, expect, test } from "bun:test";
import {
  appendArtifactLinks,
  artifactPath,
  artifactUrl,
  createdArtifactsFromSteps,
  parseArtifactHref,
  parseArtifactLocation,
  parseConversationFocus,
  withArtifactLinks,
} from "./artifact-link";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const LIST_ID = "22222222-2222-4222-8222-222222222222";
const APP = "https://app.fambot.test";

describe("artifact URLs", () => {
  test("builds path and absolute URL", () => {
    expect(artifactPath("task", TASK_ID)).toBe(`/task/${TASK_ID}`);
    expect(artifactUrl(APP, "task", TASK_ID)).toBe(`${APP}/task/${TASK_ID}`);
    expect(artifactUrl(`${APP}/`, "list", LIST_ID)).toBe(`${APP}/list/${LIST_ID}`);
  });

  test("parses a valid artifact path", () => {
    expect(parseArtifactLocation(`/task/${TASK_ID}`)).toEqual({ type: "task", id: TASK_ID });
    expect(parseArtifactLocation(`/EVENT/${TASK_ID}/`)).toEqual({ type: "event", id: TASK_ID });
  });

  test("rejects unknown types and non-UUIDs", () => {
    expect(parseArtifactLocation("/todos/abc")).toBeNull();
    expect(parseArtifactLocation(`/task/not-a-uuid`)).toBeNull();
    expect(parseArtifactLocation("/")).toBeNull();
  });

  test("parseArtifactHref reads pathnames out of absolute URLs", () => {
    expect(parseArtifactHref(`https://app.example/event/${TASK_ID}`)).toEqual({ type: "event", id: TASK_ID });
    expect(parseArtifactHref(`/list/${LIST_ID}`)).toEqual({ type: "list", id: LIST_ID });
    expect(parseArtifactHref("https://app.example/todos")).toBeNull();
  });

  test("parses conversation focus ids", () => {
    expect(parseConversationFocus(`task:${TASK_ID}`)).toEqual({ type: "task", id: TASK_ID });
    expect(parseConversationFocus("chat_guid")).toBeNull();
    expect(parseConversationFocus(null)).toBeNull();
  });
});

describe("createdArtifactsFromSteps", () => {
  test("extracts successful create_* ids only", () => {
    expect(
      createdArtifactsFromSteps([
        { toolName: "create_task", status: "executed", data: { taskId: TASK_ID, listId: LIST_ID } },
        { toolName: "create_list", status: "clarify", data: { listId: LIST_ID } },
        { toolName: "update_task", status: "executed", data: { taskId: TASK_ID } },
      ])
    ).toEqual([{ type: "task", id: TASK_ID }]);
  });

  test("ignores listId on create_task and failed creates", () => {
    expect(
      createdArtifactsFromSteps([
        { toolName: "create_task", status: "failed", data: { taskId: TASK_ID } },
        { toolName: "create_list", status: "executed", data: { listId: LIST_ID } },
      ])
    ).toEqual([{ type: "list", id: LIST_ID }]);
  });

  test("create_reminder links the parent task instead of the reminder", () => {
    expect(
      createdArtifactsFromSteps([
        {
          toolName: "create_reminder",
          status: "executed",
          data: { reminderId: LIST_ID, taskId: TASK_ID },
        },
      ])
    ).toEqual([{ type: "task", id: TASK_ID }]);
  });

  test("create_reminder links the parent event when there is no task", () => {
    expect(
      createdArtifactsFromSteps([
        {
          toolName: "create_reminder",
          status: "executed",
          data: { reminderId: LIST_ID, eventId: TASK_ID },
        },
      ])
    ).toEqual([{ type: "event", id: TASK_ID }]);
  });

  test("dedupes repeated creates", () => {
    expect(
      createdArtifactsFromSteps([
        { toolName: "create_event", status: "executed", data: { eventId: TASK_ID } },
        { toolName: "create_event", status: "executed", data: { eventId: TASK_ID } },
      ])
    ).toEqual([{ type: "event", id: TASK_ID }]);
  });

  test("create_event also links nested list and reminders", () => {
    const reminderId = "33333333-3333-4333-8333-333333333333";
    expect(
      createdArtifactsFromSteps([
        {
          toolName: "create_event",
          status: "executed",
          data: { eventId: TASK_ID, listId: LIST_ID, reminderIds: [reminderId] },
        },
      ])
    ).toEqual([
      { type: "event", id: TASK_ID },
      { type: "list", id: LIST_ID },
      { type: "reminder", id: reminderId },
    ]);
  });
});

describe("appendArtifactLinks", () => {
  test("appends missing links", () => {
    const reply = appendArtifactLinks("✓ Task added: trash", APP, [{ type: "task", id: TASK_ID }]);
    expect(reply).toBe(`✓ Task added: trash\n\n${APP}/task/${TASK_ID}`);
  });

  test("does not duplicate a link already in the reply", () => {
    const url = artifactUrl(APP, "task", TASK_ID);
    expect(appendArtifactLinks(`Done ${url}`, APP, [{ type: "task", id: TASK_ID }])).toBe(`Done ${url}`);
  });

  test("withArtifactLinks skips the generic error reply", () => {
    const skip = "Sorry — I hit a snag handling that. Mind trying again?";
    expect(
      withArtifactLinks({
        reply: skip,
        steps: [{ toolName: "create_task", status: "executed", data: { taskId: TASK_ID } }],
        appUrl: APP,
        skipReply: skip,
      })
    ).toBe(skip);
  });

  test("withArtifactLinks attaches create_task links", () => {
    const reply = withArtifactLinks({
      reply: "✓ Task added: trash",
      steps: [{ toolName: "create_task", status: "executed", data: { taskId: TASK_ID } }],
      appUrl: APP,
      skipReply: "nope",
    });
    expect(reply).toContain(`/task/${TASK_ID}`);
  });
});
