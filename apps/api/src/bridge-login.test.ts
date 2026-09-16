import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { households, members, user } from "@fambot/database";
import { auth } from "./auth";
import { bridgeLogin } from "./bridge-login";
import { db } from "./context";
import { env } from "./env";

let available = false;
let server: ReturnType<typeof Bun.serve> | null = null;
let baseUrl = "";

beforeAll(async () => {
  try {
    await db.execute("select 1" as never);
    available = true;
  } catch {
    console.warn("[bridge-login.test] local Postgres unavailable — skipping integration tests");
    return;
  }
  server = Bun.serve({ port: 0, fetch: bridgeLogin.fetch });
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server?.stop(true);
});

async function signup(email: string, password: string, name: string) {
  return auth.api.signUpEmail({ body: { email, password, name } });
}

describe("POST /api/bridge/login (integration)", () => {
  test("rejects invalid bodies and bad passwords", async () => {
    if (!available) return;
    const missing = await fetch(`${baseUrl}/api/bridge/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "x" }),
    });
    expect(missing.status).toBe(400);

    const bad = await fetch(`${baseUrl}/api/bridge/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "nope" }),
    });
    expect(bad.status).toBe(401);
  });

  test("issues the bridge token only to household owners", async () => {
    if (!available) return;
    const password = "correct-horse-battery";
    const ownerEmail = `owner-${randomUUID()}@example.com`;
    const memberEmail = `member-${randomUUID()}@example.com`;
    const owner = await signup(ownerEmail, password, "Owner");
    const extra = await signup(memberEmail, password, "Member");

    const [household] = await db
      .insert(households)
      .values({ name: `bridge-${randomUUID().slice(0, 8)}` })
      .returning();
    await db.insert(members).values([
      {
        householdId: household!.id,
        userId: owner.user.id,
        displayName: "Owner",
        role: "owner",
      },
      {
        householdId: household!.id,
        userId: extra.user.id,
        displayName: "Member",
        role: "member",
      },
    ]);

    const memberLogin = await fetch(`${baseUrl}/api/bridge/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: memberEmail, password }),
    });
    expect(memberLogin.status).toBe(403);

    const ownerLogin = await fetch(`${baseUrl}/api/bridge/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: ownerEmail, password }),
    });
    expect(ownerLogin.status).toBe(200);
    const body = (await ownerLogin.json()) as { token: string; user: { email: string } };
    expect(body.token).toBe(env.BRIDGE_TOKEN);
    expect(body.user.email).toBe(ownerEmail);

    await db.delete(members).where(eq(members.householdId, household!.id));
    await db.delete(households).where(eq(households.id, household!.id));
    await db.delete(user).where(eq(user.id, owner.user.id));
    await db.delete(user).where(eq(user.id, extra.user.id));
  });
});
