import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { checklistItems, createDb, events, households, lists, members, reminders, tasks, type Db } from "@fambot/database";
import { loadArtifactPreview, parseArtifactParams, renderArtifactOgHtml, toPublicPreview } from "./artifact-preview";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:fambot@localhost:5433/fambot";
let db: Db;
let available = false;

beforeAll(async () => {
  db = createDb(DATABASE_URL);
  try {
    await db.execute("select 1" as never);
    available = true;
  } catch {
    console.warn("[artifact-preview.test] local Postgres unavailable — skipping integration tests");
  }
});

describe("parseArtifactParams", () => {
  test("normalizes type case to match portal paths", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(parseArtifactParams("EVENT", id)).toEqual({ type: "event", id });
    expect(parseArtifactParams("todo", id)).toBeNull();
  });
});

describe("renderArtifactOgHtml", () => {
  test("embeds title and description as Open Graph tags", () => {
    const html = renderArtifactOgHtml({
      preview: {
        type: "task",
        id: "11111111-1111-4111-8111-111111111111",
        title: "Take out trash",
        label: "Task",
        ogTitle: "Task: Take out trash",
        description: "Due Fri Sep 13 at 8:00 PM · open",
        status: "open",
        when: "2026-09-13T20:00:00.000Z",
        timezone: "America/New_York",
      },
      canonicalUrl: "https://app.fambot.test/task/11111111-1111-4111-8111-111111111111",
    });
    expect(html).toContain('<meta property="og:title" content="Task: Take out trash">');
    expect(html).toContain('<meta property="og:description" content="Due Fri Sep 13 at 8:00 PM · open">');
    expect(html).toContain('<meta name="twitter:title" content="Task: Take out trash">');
    expect(html).not.toContain("notes");
  });
});

describe("loadArtifactPreview", () => {
  test("returns title/when for a task and omits notes", async () => {
    if (!available) return;
    const [household] = await db.insert(households).values({ name: `Preview ${randomUUID()}` }).returning();
    const [owner] = await db
      .insert(members)
      .values({ householdId: household!.id, displayName: "Nick", role: "owner" })
      .returning();
    const due = new Date("2026-09-13T20:00:00.000Z");
    const [task] = await db
      .insert(tasks)
      .values({
        householdId: household!.id,
        creatorMemberId: owner!.id,
        title: "Take out trash",
        notes: "secret side note",
        assigneeMemberId: owner!.id,
        dueAt: due,
        timezone: "America/New_York",
      })
      .returning();

    const record = await loadArtifactPreview(db, "task", task!.id);
    expect(record).not.toBeNull();
    const pub = toPublicPreview(record!);
    expect(pub.title).toBe("Take out trash");
    expect(pub.ogTitle).toBe("Task: Take out trash");
    expect(pub.description).toContain("assigned to Nick");
    expect(pub.description).toContain("open");
    expect(pub.description).not.toContain("secret");
    expect(JSON.stringify(pub)).not.toContain("householdId");
    expect(JSON.stringify(pub)).not.toContain("secret side note");
  });

  test("counts list items and remaining", async () => {
    if (!available) return;
    const [household] = await db.insert(households).values({ name: `Preview ${randomUUID()}` }).returning();
    const [list] = await db.insert(lists).values({ householdId: household!.id, name: "Groceries" }).returning();
    await db.insert(checklistItems).values([
      { listId: list!.id, body: "Milk", sortOrder: 0 },
      { listId: list!.id, body: "Eggs", completedAt: new Date(), sortOrder: 1 },
    ]);

    const record = await loadArtifactPreview(db, "list", list!.id);
    expect(record?.ogTitle).toBe("List: Groceries");
    expect(record?.description).toBe("2 items · 1 remaining");
  });

  test("returns null for missing artifacts", async () => {
    if (!available) return;
    expect(await loadArtifactPreview(db, "reminder", "99999999-9999-4999-8999-999999999999")).toBeNull();
  });

  test("returns reminder fire time without extra notes fields", async () => {
    if (!available) return;
    const [household] = await db.insert(households).values({ name: `Preview ${randomUUID()}` }).returning();
    const [owner] = await db
      .insert(members)
      .values({ householdId: household!.id, displayName: "Sam", role: "owner" })
      .returning();
    const fire = new Date("2026-09-14T12:00:00.000Z");
    const [task] = await db
      .insert(tasks)
      .values({ householdId: household!.id, creatorMemberId: owner!.id, title: "Host game night" })
      .returning();
    const [reminder] = await db
      .insert(reminders)
      .values({
        householdId: household!.id,
        creatorMemberId: owner!.id,
        title: "Game night",
        taskId: task!.id,
        targetType: "member",
        targetMemberId: owner!.id,
        fireAt: fire,
        nextFireAt: fire,
        timezone: "America/New_York",
      })
      .returning();
    const record = await loadArtifactPreview(db, "reminder", reminder!.id);
    expect(record?.ogTitle).toBe("Reminder: Game night");
    expect(record?.description).toContain("Fires");
    expect(record?.description).toContain("one-shot");
  });

  test("includes event notes as the description body", async () => {
    if (!available) return;
    const [household] = await db.insert(households).values({ name: `Preview ${randomUUID()}` }).returning();
    const [row] = await db
      .insert(events)
      .values({
        householdId: household!.id,
        title: "Soccer practice",
        startsAt: new Date("2026-09-16T21:00:00.000Z"),
        location: "Field 3",
        notes: "Bring shin guards and water.",
        timezone: "America/New_York",
      })
      .returning();
    const record = await loadArtifactPreview(db, "event", row!.id);
    expect(record?.ogTitle).toBe("Event: Soccer practice");
    expect(record?.description).toContain("Field 3");
    expect(record?.description).toContain("Bring shin guards and water.");
  });
});
