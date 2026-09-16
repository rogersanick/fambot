import { Hono } from "hono";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { members } from "@fambot/database";
import { auth } from "./auth";
import { db } from "./context";
import { env } from "./env";

/**
 * Interactive Mac-bridge login. The relay still uses BRIDGE_TOKEN on ingest/WS;
 * this endpoint just proves the operator is a household owner and issues that
 * token so a laptop can point at local or prod without copying Fly secrets.
 */

const LoginSchema = z
  .object({
    email: z.string().min(1).optional(),
    username: z.string().min(1).optional(),
    password: z.string().min(1),
  })
  .refine((body) => Boolean(body.email?.trim() || body.username?.trim()), {
    message: "email is required",
  });

export async function authenticateBridgeOwner(email: string, password: string) {
  let user: { id: string; name: string; email: string };
  try {
    const result = await auth.api.signInEmail({
      body: { email, password, rememberMe: true },
      headers: new Headers({ origin: env.API_BASE_URL }),
    });
    if (!result?.user) return { ok: false as const, status: 401 as const, error: "unauthorized" };
    user = result.user;
  } catch (err) {
    const status =
      err && typeof err === "object" && "statusCode" in err ? Number(err.statusCode) : 401;
    if (status === 401 || status === 400 || status === 403) {
      return { ok: false as const, status: 401 as const, error: "unauthorized" };
    }
    throw err;
  }

  const [owner] = await db
    .select({ id: members.id })
    .from(members)
    .where(and(eq(members.userId, user.id), eq(members.role, "owner")))
    .limit(1);
  if (!owner) return { ok: false as const, status: 403 as const, error: "owner_required" };

  return {
    ok: true as const,
    token: env.BRIDGE_TOKEN,
    user: { name: user.name, email: user.email },
  };
}

export const bridgeLogin = new Hono();

bridgeLogin.post("/api/bridge/login", async (c) => {
  const parsed = LoginSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "invalid_body" }, 400);
  const email = (parsed.data.email ?? parsed.data.username ?? "").trim();
  const result = await authenticateBridgeOwner(email, parsed.data.password);
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return c.json({ token: result.token, user: result.user });
});
