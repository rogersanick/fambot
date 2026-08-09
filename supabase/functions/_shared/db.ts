import postgres from "npm:postgres@3.4.5";

// One connection pool per isolate. postgres.js gives us real transactions,
// which the executor requires (entity + reminders + audit + outbox are all
// or nothing). Edge functions connect with the superuser-equivalent DB URL;
// RLS is the portal's boundary, not this one.
let sql: ReturnType<typeof postgres> | null = null;

export function getSql(): ReturnType<typeof postgres> {
  if (!sql) {
    const url = Deno.env.get("SUPABASE_DB_URL");
    if (!url) throw new Error("SUPABASE_DB_URL is not set");
    sql = postgres(url, { max: 4, prepare: false });
  }
  return sql;
}

export type Sql = ReturnType<typeof getSql>;
/** A transaction handle as passed to `sql.begin` callbacks. */
export type Tx = Parameters<Parameters<Sql["begin"]>[1]>[0] extends never
  ? never
  : any;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
