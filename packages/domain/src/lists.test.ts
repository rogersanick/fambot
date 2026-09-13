import { beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { createDb, households, members, type Db } from "@fambot/database";
import { executeActions, type ExecutionContext } from "./executor";
import { createServices, type Services } from "./services";

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://postgres:fambot@localhost:5433/fambot";

let db: Db;
let services: Services;
let available = false;

beforeAll(async () => {
  db = createDb(DATABASE_URL);
  try {
    await db.execute("select 1" as never);
    available = true;
  } catch {
    console.warn("[lists.test] local Postgres unavailable — skipping integration tests");
  }
  services = createServices(db);
});

async function fixture(): Promise<ExecutionContext> {
  const [household] = await db
    .insert(households)
    .values({ name: `lists-${randomUUID().slice(0, 8)}`, timezone: "America/New_York" })
    .returning();
  const [member] = await db
    .insert(members)
    .values({ householdId: household!.id, displayName: "Tester", role: "owner" })
    .returning();
  return {
    db,
    services,
    householdId: household!.id,
    timezone: household!.timezone,
    actor: {
      memberId: member!.id,
      householdId: household!.id,
      role: "owner",
      displayName: member!.displayName,
    },
    conversation: null,
    participants: [{ id: member!.id, displayName: member!.displayName }],
    householdMembers: [{ id: member!.id, displayName: member!.displayName }],
  };
}

describe("list item actions (integration)", () => {
  test("create, read, update, check, and delete list items without comments", async () => {
    if (!available) return;
    const ctx = await fixture();

    let outcome = await executeActions(ctx, [
      { type: "create_list", name: "groceries", items: ["milk", "eggs"] },
    ]);
    expect(outcome.executions[0]!.status).toBe("executed");

    const list = await services.lists.findByName(ctx.householdId, "groceries");
    expect(list).not.toBeNull();
    expect((await services.lists.items(ctx.householdId, list!.id)).map((item) => item.title)).toEqual([
      "milk",
      "eggs",
    ]);

    await executeActions(ctx, [
      { type: "add_list_items", list_name: "groc", items: ["cheese"] },
      {
        type: "update_list_item",
        list_name: "groceries",
        item_ref: "cheese",
        new_title: "cheddar",
      },
      {
        type: "set_list_item_completed",
        list_name: "groceries",
        item_ref: "milk",
        completed: true,
      },
      { type: "delete_list_item", list_name: "groceries", item_ref: "eggs" },
    ]);

    outcome = await executeActions(ctx, [{ type: "get_list", list_name: "groc" }]);
    expect(outcome.reply).toContain("✓ milk");
    expect(outcome.reply).toContain("○ cheddar");
    expect(outcome.reply).not.toContain("eggs");
    expect(await services.comments.listBySubject(ctx.householdId, { type: "list", id: list!.id })).toEqual([]);
  });
});
