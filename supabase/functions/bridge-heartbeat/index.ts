import { getSql, jsonResponse } from "../_shared/db.ts";
import { verifyBridge } from "../_shared/bridge-auth.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);
  const bridge = await verifyBridge(req);
  if (bridge instanceof Response) return bridge;

  const body = await req.json().catch(() => ({}));
  const sql = getSql();

  await sql`
    update bridges
       set last_seen_at = now(),
           worker_version = coalesce(${body.worker_version ?? null}, worker_version),
           macos_version = coalesce(${body.macos_version ?? null}, macos_version),
           bluebubbles_version = coalesce(${body.bluebubbles_version ?? null}, bluebubbles_version)
     where id = ${bridge.id}
  `;

  // The invocation map lets the bridge match custom bot names locally.
  // Renames take effect within one heartbeat; 'fambot' always works.
  const rows = await sql<{ chat_guid: string; invocation_name: string }[]>`
    select c.chat_guid, h.invocation_name
      from channels c
      join households h on h.id = c.household_id
     where c.bridge_id = ${bridge.id}
       and c.state = 'active'
       and h.state = 'active'
  `;

  const invocationMap: Record<string, string> = {};
  for (const row of rows) invocationMap[row.chat_guid] = row.invocation_name;

  return jsonResponse({ invocation_map: invocationMap });
});
