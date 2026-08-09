# 07 — imsg transport (replaces BlueBubbles)

The bridge's iMessage transport is [imsg](https://imsg.sh), a signed/notarized CLI
that reads `~/Library/Messages/chat.db` directly and sends through Messages.app's
AppleScript surface. The bridge spawns and supervises **one long-lived
`imsg rpc` child** speaking JSON-RPC 2.0 (one JSON object per line) on
stdin/stdout — no GUI app, no TCP port, no webhook server, no daemon.

## Module map

| Concern | Module | Notes |
|---|---|---|
| Child lifecycle + JSON-RPC | `bridge/src/imsg-rpc.ts` | spawn `IMSG_BIN` `rpc`; correlate requests by id; route `message` notifications; restart with backoff (1s → 30s) on death; kill on shutdown |
| Receive | `watch.subscribe` (all chats) | notifications flow into `bridge/src/inbound.ts` (allowlist, self-message rules, context buffer, invocation spooling — carried over from the webhook listener unchanged) |
| Send | `send` with `chat_guid` + text | called by `outbox-poller.ts`; returned `guid` (best-effort) goes into the sent ledger |
| Roster | `chats.list` | participants (handles only) ride along on ingest payloads |
| Catchup | `since_rowid` cursor | max seen message rowid persisted in the spool SQLite `kv` table; resubscribe from it after restarts so messages during downtime replay; stale cursor (replaced chat.db) falls back to a fresh watch |

## Identity invariants

- imsg's `chat_guid` is the same `chat.guid` value BlueBubbles used
  (`iMessage;+;chat…`), so `channels.address`, `CHAT_ALLOWLIST`, the
  heartbeat invocation map, and all edge functions are unchanged.
- Self-messages echo back through the watch stream as `is_from_me`; the
  local-dev prefix + sent-ledger rules and the production plain-drop rule
  are identical to before.

## Permissions (one-time, per Mac)

1. Full Disk Access for the process tree that runs the bridge (imsg inherits it).
2. Automation ("control Messages") approved on the first send.

## Testing

`bridge npm test` (node:test via tsx): `imsg-rpc.test.ts` drives the client
against an in-memory fake child (framing, correlation, notifications, cursor
monotonicity, death → restart → resubscribe, stale-cursor fallback, stop);
`inbound.test.ts` covers filtering and spooling against a temp SQLite spool.
These in-process fakes are the only mocks in the repo — live verification is
done against real Messages.
