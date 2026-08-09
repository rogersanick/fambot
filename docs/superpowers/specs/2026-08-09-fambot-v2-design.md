# FamBot v2 — maximally extensible, minimally scoped

**Date:** 2026-08-09
**Status:** Approved (Approach A), building immediately.

## One-paragraph summary

FamBot v2 is a Supabase-powered Next.js app (todos, calendar, reminders) that
exposes its entire capability surface as an **MCP server**. iMessage is handled
by the **simplest possible bridge**: an always-on process on the owner's Mac
that piggybacks on their existing iMessage identity via [imsg](https://imsg.sh).
When someone tags `@fambot` in an allowlisted chat, the bridge invokes a
**pluggable agent** (osaurus/local models, Claude Code, anything) which does its
work through the MCP tools, and the bridge sends the agent's reply back over
iMessage. The messaging channel and the agent are both pluggable seams; the app
never contains an LLM pipeline.

## What this replaces (v1 complexity being deleted)

| v1 piece | v2 fate |
|---|---|
| 15-table schema (bridges, channels, inbound_messages, bot_runs, outbox, pending_clarifications, link_codes, audit_log, app_config, …) | 6 tables: `households`, `members`, `channels`, `tasks`, `events`, `reminders` |
| 4 Deno edge functions + bridge bearer auth + heartbeat | none — deleted |
| Outbox leasing / spool forwarding / adaptive polling | none — bridge invokes the agent directly, replies synchronously |
| Agent core (17 intents, strict JSON schema, validator, executor, composer, clarifications) | not our problem — the agent is external and pluggable |
| SQLite spool + sent ledger | JSON cursor file + in-memory sent set + prefix match |
| Kept: `bridge/src/imsg-rpc.ts` (supervised `imsg rpc` child) | kept nearly unchanged, tests included |
| Kept: Next.js/shadcn portal shell | rebuilt pages on the new schema |

## Decisions (from brainstorming)

1. **Bridge invokes the agent directly** — no queue/outbox. The bridge→agent
   interface is one function so a queued version could be swapped in later.
2. **Hosted Supabase + Vercel for production; everything runs locally for dev**
   (local Supabase via CLI + `next dev`). This build targets local.
3. **Reminders**: the bridge polls Supabase (~30 s) for due reminders and sends
   them via imsg. No cron, no outbox. Laptop asleep ⇒ reminders send late.
4. **Onboarding stays, agent-driven**: when a chat has no household, the agent
   sees that in `get_context` and walks setup using MCP tools
   (`setup_household`, `add_member`).
5. **MCP auth = Supabase-issued JWTs.** The MCP endpoint verifies bearer tokens
   against Supabase auth. The agent is a real Supabase user and a household
   member with role `agent`; RLS applies to everything it does. The bridge
   signs in as the agent user and keeps a fresh access token available to both
   adapters. (Full OAuth 2.1 discovery flow can be layered on later; token
   verification path is identical.)
6. **Two agent adapters**:
   - `cli`: shell out to any command (e.g. `claude -p`). The command receives
     the prompt on stdin and env vars `FAMBOT_MCP_URL` + `FAMBOT_MCP_TOKEN`;
     stdout is the reply. The agent brings its own MCP client.
   - `openai`: the bridge drives a tool-calling loop against any
     OpenAI-compatible endpoint (osaurus, LM Studio, OpenRouter), executing
     tool calls through fambot's MCP server itself.

## Components

### 1. Database (Supabase Postgres, one migration)

- `households` — id, name, timezone, created_at.
- `members` — id, household_id, display_name, role (`owner`|`member`|`agent`),
  handle (normalized phone/email for iMessage sender matching, nullable),
  user_id (nullable link to `auth.users`), created_at. Unique
  (household_id, handle) where handle is not null.
- `channels` — id, household_id, chat_guid (unique), name, created_at. Maps an
  iMessage chat to a household.
- `tasks` — id, household_id, title, notes, status (`open`|`done`|`cancelled`),
  assignee_id → members, due_at, created_by → members, completed_at,
  created_at, updated_at.
- `events` — id, household_id, title, starts_at, ends_at, location, notes,
  created_by, created_at, updated_at.
- `reminders` — id, household_id, message, fire_at, channel_id → channels
  (nullable ⇒ household's first channel), member_id (who it's for, nullable),
  task_id/event_id (nullable links), status (`pending`|`sent`|`cancelled`),
  sent_at, created_by, created_at.

**RLS**: enabled on all tables; `anon` has no access. A helper
`is_household_member(hid)` checks `members.user_id = auth.uid()`. Members of a
household can select/insert/update household-scoped rows. Household creation
goes through a security-definer RPC `setup_household(name, timezone, chat_guid)`
that creates the household, adds the caller as a member, and maps the channel —
this avoids the RLS chicken-and-egg on first insert.

### 2. Next.js app (`web/`)

- **Portal**: email/password auth (Supabase), a dashboard with three sections —
  Todos, Calendar, Reminders — with simple CRUD (server actions). Members and
  channel mapping visible under Settings. Multi-household capable; UI picks the
  user's households.
- **MCP server**: `app/mcp/route.ts` using `mcp-handler` (streamable HTTP,
  stateless) wrapped in `withMcpAuth`. Token verification = Supabase
  `auth.getUser(token)`. Every tool handler builds a Supabase client bound to
  the caller's JWT so **RLS is the authorization layer** — the MCP server adds
  no privileges.

**MCP tools** (household-scoped, all return compact JSON text):
`get_context` (household(s) for the caller + optional chat_guid resolution,
members, timezone, current time — the agent's first call),
`setup_household`, `add_member`, `list_members`, `map_channel`,
`create_task`, `list_tasks`, `update_task` (status/assignee/due/title),
`create_event`, `list_events`, `update_event`, `delete_event`,
`create_reminder`, `list_reminders`, `cancel_reminder`.

### 3. Bridge (`bridge/`) — the always-on laptop process

- `imsg-rpc.ts` — kept: supervised `imsg rpc` child, JSON-RPC framing, cursor
  resubscribe, restart backoff. Cursor persisted to a JSON state file (SQLite
  spool deleted).
- `inbound.ts` — kept logic, simplified deps: chat allowlist, self-message
  rules (prefix match + in-memory sent-guid set), context ring buffer
  (8 msgs / 10 min), `@fambot` tag matching. On invocation it calls the agent
  runner instead of spooling.
- `agent/run-cli.ts` + `agent/run-openai.ts` — the two adapters behind one
  `runAgent(prompt) => reply` interface. Runs are serialized per chat.
- `prompt.ts` — builds the agent prompt: chat_guid, sender handle/name, recent
  context turns, reply-style instructions (plain text, ≤3 lines, no markdown).
- `supabase-session.ts` — signs in as the agent user (email/password from env),
  refreshes, exposes `getAccessToken()`.
- `reminders.ts` — every 30 s: select due pending reminders (RLS as agent),
  send via imsg to the mapped channel, mark sent.
- `index.ts` — wiring; replies are sent with the `Fambot says: 🤖✨` prefix and
  their GUIDs recorded for self-message drop.

### 4. Bootstrap script (`scripts/bootstrap-local.mjs`)

Creates (idempotently) against local Supabase: an owner user and an agent user
(emails/passwords from env or defaults), so the portal login and the bridge
sign-in work immediately. Household creation happens in the portal or via
in-chat onboarding.

## Data flow

**Inbound**: iMessage → `imsg rpc` watch → inbound filter → prompt build →
`runAgent` → agent calls MCP tools (HTTP, Supabase JWT) → reply text → imsg
send (prefixed).
**Reminders**: portal/agent creates reminder row → bridge poll finds it due →
imsg send → row marked sent.
**Portal**: browser → Next.js server actions → Supabase (RLS).

## Error handling

- Agent failure/timeout (120 s cli, 90 s openai): bridge replies with a short
  apology line; the message is not retried (the human can re-tag).
- imsg child death: existing supervision — restart with backoff, resubscribe
  from cursor; messages during downtime replay.
- Reminder send failure: row stays pending; next poll retries. `sent_at` set
  only on imsg success.
- MCP auth failure: 401 with RFC 9728 challenge (from `withMcpAuth`).

## Testing

- Bridge unit tests (kept/adapted): imsg JSON-RPC framing, supervision,
  cursor; inbound filtering + invocation against fakes.
- New: openai-loop adapter test against an in-process fake chat-completions
  server + fake MCP tool executor; cli adapter test with a stub script.
- Local smoke: real MCP round trip (script client with the agent's real JWT →
  create/list a task), portal CRUD in the browser, fake-imsg end-to-end.
- Real iMessage verification requires the owner's Mac (Full Disk Access +
  Automation grants) and is documented, not CI-tested.

## Out of scope (v2)

Clarification lifecycle, audit log, quiet hours, link codes, bot-run
telemetry, production deployment (Vercel/hosted Supabase), OAuth discovery
flow for MCP, non-iMessage channels (the MCP seam is where they'd plug in).
