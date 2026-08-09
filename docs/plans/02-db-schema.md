# Task plan: database schema

One migration (`supabase/migrations/20260804000001_init.sql`) plus `supabase/seed.sql`.

## Steps

1. Extensions: `pgcrypto` (secret hashing), `pg_cron` (scheduling).
2. Helper `fambot_nanoid(size, alphabet)` — lowercase alphanumeric IDs used as defaults for `households.slug` (8) and `tasks/events.short_code` (6).
3. `app_config` key/value table (seeded with `app_base_url`) so SQL-side composers (reminder cron) can build deep links.
4. Tables, in dependency order: `bridges`, `households`, `channels`, `members`, `member_links`, `link_codes`, `inbound_messages`, `bot_runs`, `tasks`, `events`, `reminders`, `pending_clarifications`, `outbox`, `audit_log`. CHECK constraints on all state/status columns; `reminders` exactly-one-of task/event; partial unique index for one open clarification per household.
5. Indexes: outbox `(state, not_before, created_at)`, reminders `(state, fire_at)`, tasks `(household_id, status)`, events `(household_id, starts_at)`, plus the uniques from the data model.
6. Audit triggers on `tasks` and `events` (INSERT/UPDATE). Actor from transaction-locals `fambot.actor_type` / `fambot.actor_member_id` / `fambot.inbound_message_id` (bot path) or `auth.uid()` via `member_links` (portal path).
7. RLS: enabled everywhere; `anon` zero access. `authenticated` SELECT on household-scoped domain tables via `member_links` membership; INSERT/UPDATE on `tasks`/`events`; `member_links` self-select. Transport tables service-role only (explicit REVOKEs).
8. Security-definer RPCs for the portal: `update_household_settings`, `redeem_link_code`, `auto_link_member_by_email`, `complete_task`/`cancel_task` style mutations stay plain RLS updates.
9. Cron functions: `enqueue_due_reminders()` (5-min aggregation per channel, quiet-hours deferral, idempotent outbox inserts), `expire_clarifications()`, `release_expired_outbox_leases()`; scheduled every minute with pg_cron.
10. `seed.sql`: local-dev bridge row (fixed UUID, SHA-256 of `local-dev-bridge-secret`), `app_base_url = http://localhost:3000`.
