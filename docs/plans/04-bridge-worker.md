# Task plan: Mac bridge worker

> **Superseded in part by [07-imsg-transport.md](07-imsg-transport.md):** the
> BlueBubbles webhook/REST transport described here was replaced by a
> supervised `imsg rpc` child (`imsg-rpc.ts` + `inbound.ts`). The spool,
> context buffer, invocation matcher, forwarder, poller, and heartbeat are
> unchanged.

Node 24 + TypeScript, better-sqlite3, Zod. Transport only — no service-role key, no business logic.

## Modules (`bridge/src/`)

- `config.ts` — Zod-validated env (profile, ports, BlueBubbles URL/password, functions URL, bridge id/secret, chat allowlist, bot prefix, spool path).
- `bluebubbles.ts` — thin client: `sendText(chatGuid, text)` (`POST /api/v1/message/text`), `getChat(guid)` with participants, `ping`.
- `spool.ts` — SQLite: `spool` (invocation payloads pending forward, retry state, delivered rows deleted after 7 days) and `sent_ledger` (GUIDs of messages we sent — self-message detection leg 2).
- `context-buffer.ts` — in-memory per-channel ring buffer, cap 8 messages / 10 minutes, never persisted.
- `invocation.ts` — case-insensitive tag matching: `@fambot`/`fambot` always, plus the channel's custom name from the heartbeat-synced invocation map.
- `fambot-api.ts` — bearer-secret client for the four edge functions (`X-Fambot-Bridge-ID` + `Authorization: Bearer`).
- `webhook.ts` — listener on `127.0.0.1:4321`: drop non-text events; local-dev filter = chat allowlist, then prefix match or sent-ledger hit (self-message); otherwise buffer the turn; on invocation tag, select context (replied-to first, else ≤8 msgs/10 min) and spool.
- `forwarder.ts` — drain spool → `ingest-message`, exponential backoff, mark delivered.
- `outbox-poller.ts` — adaptive poll of `pull-outbox`: 1 s burst for 15 s after forwarding, 15 s idle, backoff to 60 s on failure, batch 10, 60 s lease; prepend the local-dev prefix at send time; record sent GUID in ledger; `acknowledge-outbox`.
- `heartbeat.ts` — every 60 s; response carries the `chat_guid → invocation_name` map.
- `index.ts` — wiring + foreground logging.
