import { getSql } from "./db.ts";

export interface BridgeIdentity {
  id: string;
  name: string;
  status: string;
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Bridge auth: `X-Fambot-Bridge-ID` + `Authorization: Bearer <secret>`.
 * The secret's SHA-256 must match `bridges.secret_hash` and the bridge must
 * be active. Replay is harmless: ingest is idempotent, pulls use leases.
 */
export async function verifyBridge(req: Request): Promise<BridgeIdentity | Response> {
  const bridgeId = req.headers.get("x-fambot-bridge-id");
  const auth = req.headers.get("authorization");
  if (!bridgeId || !auth?.toLowerCase().startsWith("bearer ")) {
    return new Response(JSON.stringify({ error: "missing bridge credentials" }), { status: 401 });
  }
  const secret = auth.slice(7).trim();
  const hash = await sha256Hex(secret);

  const sql = getSql();
  const rows = await sql<{ id: string; name: string; status: string; secret_hash: string }[]>`
    select id, name, status, secret_hash from bridges where id = ${bridgeId}
  `;
  const bridge = rows[0];
  if (!bridge || bridge.secret_hash !== hash) {
    return new Response(JSON.stringify({ error: "invalid bridge credentials" }), { status: 401 });
  }
  if (bridge.status !== "active") {
    return new Response(JSON.stringify({ error: "bridge disabled" }), { status: 403 });
  }
  return { id: bridge.id, name: bridge.name, status: bridge.status };
}
