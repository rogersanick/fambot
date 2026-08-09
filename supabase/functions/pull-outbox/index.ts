import { getSql, jsonResponse } from "../_shared/db.ts";
import { verifyBridge } from "../_shared/bridge-auth.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);
  const bridge = await verifyBridge(req);
  if (bridge instanceof Response) return bridge;

  const body = await req.json().catch(() => ({}));
  const batchSize = Math.min(Math.max(Number(body.batch_size) || 10, 1), 50);
  const leaseSeconds = Math.min(Math.max(Number(body.lease_seconds) || 60, 10), 300);
  const leaseOwner = `bridge:${bridge.id}`;

  const sql = getSql();
  const messages = await sql.begin(async (tx) => {
    const rows = await tx<
      { id: string; chat_guid: string; message_type: string; message_text: string }[]
    >`
      select id, chat_guid, message_type, message_text
        from outbox
       where bridge_id = ${bridge.id}
         and state in ('pending', 'retry')
         and (not_before is null or not_before <= now())
       order by created_at
       limit ${batchSize}
         for update skip locked
    `;
    if (rows.length > 0) {
      await tx`
        update outbox
           set state = 'leased',
               lease_owner = ${leaseOwner},
               lease_expires_at = now() + make_interval(secs => ${leaseSeconds})
         where id in ${tx(rows.map((r) => r.id))}
      `;
    }
    return rows;
  });

  return jsonResponse({ messages });
});
