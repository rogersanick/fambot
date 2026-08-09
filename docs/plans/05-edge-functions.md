# Task plan: edge functions

Four Deno edge functions plus shared modules. All DB access uses postgres.js
(`npm:postgres`) over `SUPABASE_DB_URL` so the executor gets real transactions;
no service-role key ever leaves the functions.

## Shared (`supabase/functions/_shared/`)

- `db.ts` — postgres.js client (one per isolate).
- `bridge-auth.ts` — verify `X-Fambot-Bridge-ID` + `Authorization: Bearer`; SHA-256 the secret and compare to `bridges.secret_hash`; reject unknown/disabled bridges.
- `agent/` — the agent pipeline (see 06-agent-core.md).

## Functions

- `ingest-message` — auth → Zod-parse payload → idempotent insert on `(bridge_id, message_guid)` (duplicate → 200, no effects) → resolve channel (create `pending_setup` on unknown chat) → route: onboarding flow for channels without an active household, deterministic quick intents (help/stop/link/cancel), otherwise the agent pipeline → mark `processing_state`.
- `pull-outbox` — auth → lease up to `batch_size` pending rows (`not_before` respected) with `FOR UPDATE SKIP LOCKED`, set `leased`/`lease_owner`/`lease_expires_at` (60 s) → return messages FIFO.
- `acknowledge-outbox` — auth → per-result: `sent` → mark sent (+ mark linked reminders delivered); `failed` → attempts+1, back to `retry` (→ `failed` after 5).
- `bridge-heartbeat` — auth → update `bridges.last_seen_at` + versions → return `chat_guid → invocation_name` for the bridge's channels.
