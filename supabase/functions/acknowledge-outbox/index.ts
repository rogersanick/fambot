import { getSql, jsonResponse } from "../_shared/db.ts";
import { verifyBridge } from "../_shared/bridge-auth.ts";

const MAX_ATTEMPTS = 5;

interface AckResult {
  id: string;
  status: "sent" | "failed";
  error?: string;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "method not allowed" }, 405);
  const bridge = await verifyBridge(req);
  if (bridge instanceof Response) return bridge;

  const body = await req.json().catch(() => ({}));
  const results: AckResult[] = Array.isArray(body.results) ? body.results : [];
  if (results.length === 0) return jsonResponse({ status: "ok" });

  const sql = getSql();
  await sql.begin(async (tx) => {
    for (const r of results) {
      if (r.status === "sent") {
        await tx`
          update outbox
             set state = 'sent', sent_at = now(),
                 lease_owner = null, lease_expires_at = null
           where id = ${r.id} and bridge_id = ${bridge.id}
        `;
        // Reminder deliveries complete when their outbox row is sent.
        await tx`
          update reminders
             set state = 'delivered', delivered_at = now()
           where state = 'enqueued'
             and 'reminder:' || id::text = (
               select dedupe_key from outbox where id = ${r.id}
             )
        `;
      } else {
        await tx`
          update outbox
             set attempts = attempts + 1,
                 last_error = ${r.error ?? "send failed"},
                 lease_owner = null, lease_expires_at = null,
                 state = case when attempts + 1 >= ${MAX_ATTEMPTS} then 'failed' else 'retry' end
           where id = ${r.id} and bridge_id = ${bridge.id}
        `;
      }
    }
    await tx`update bridges set last_outbound_at = now() where id = ${bridge.id}`;
  });

  return jsonResponse({ status: "ok" });
});
