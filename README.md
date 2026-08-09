# FamBot

FamBot is a text-only AI assistant that lives inside ordinary iMessage group chats. Members tag `@fambot` in natural language to create, update, complete, list, and schedule shared tasks and events. Every FamBot reply ends with a deep link into a web portal showing the live artifact.

**V1 scope: everything runs on one local Mac** — local Supabase, local Next.js portal, and [imsg](https://imsg.sh) on your own iMessage identity with a `Fambot says: 🤖✨` prefix.

## Repo structure

```
fambot/
  bridge/    # Mac bridge worker: Node 24, TS, supervised imsg rpc child, better-sqlite3, Zod
  supabase/  # migrations/, functions/ (Deno edge functions), seed.sql, config.toml
  web/       # Next.js portal: App Router, TS, Tailwind, shadcn/ui, @supabase/ssr
  docs/      # design docs and per-task implementation plans (docs/plans/)
```

## Prerequisites

- macOS with Messages signed in (your own identity in local-dev)
- [imsg](https://imsg.sh) — `brew install steipete/tap/imsg` (or the notarized binary from [GitHub releases](https://github.com/steipete/imsg/releases))
- Node.js 24+, Docker (for local Supabase), [Supabase CLI](https://supabase.com/docs/guides/cli)
- An LLM API key (any OpenAI-compatible structured-output endpoint)

## One-time macOS permissions

imsg reads `~/Library/Messages/chat.db` and sends through Messages.app's AppleScript surface. Two grants, once each:

1. **Full Disk Access** for the terminal app that runs the bridge (System Settings → Privacy & Security → Full Disk Access). Verify with `imsg chats --limit 3`.
2. **Automation**: the first send pops "…wants to control Messages" — click Allow.

## Quickstart (local-dev)

1. **Start Supabase** (Postgres, auth, edge runtime):

   ```sh
   supabase start
   supabase db reset          # applies migrations + seed.sql
   ```

2. **Serve edge functions** (separate terminal):

   ```sh
   cp supabase/functions/.env.example supabase/functions/.env   # fill in LLM key
   npm run functions:serve
   ```

3. **Start the portal** (separate terminal):

   ```sh
   cd web
   cp .env.example .env.local   # local Supabase URL + anon key from `supabase status`
   npm install && npm run dev   # http://localhost:3000
   ```

4. **Start the bridge** (separate terminal):

   ```sh
   cd bridge
   cp .env.example .env         # fill in chat allowlist
   npm install && npm run dev
   ```

   The bridge spawns and supervises one `imsg rpc` child — no daemon, no ports, no webhook. To find your group chat's GUID for `CHAT_ALLOWLIST`:

   ```sh
   imsg chats --limit 20 --json | jq -r '[.guid, .name] | @tsv'
   ```

5. **Round trip**: in the allowlisted group chat, send `@fambot hello`. FamBot replies with the onboarding message. Then `@fambot setup Rogers Family`, give it a timezone, and start adding tasks. Every reply's last line is a `http://localhost:3000/...` deep link into the portal.

## Tests

Bridge unit tests (JSON-RPC framing, supervision/restart, inbound filtering) use in-process fakes — no Messages access needed:

```sh
cd bridge && npm test
```

## Deployment profiles

| | `local-dev` (v1) | `production` (deferred) |
|---|---|---|
| Mac identity | your personal iMessage account | dedicated FamBot Apple Account |
| Supabase | `supabase start` (local) | hosted project |
| Portal | `next dev` at `localhost:3000` | Vercel + custom domain |
| Message prefix | `Fambot says: 🤖✨` | none |
| Self-message rule | prefix + sent-ledger matching | plain `is_from_me` drop |
| Chat filter | explicit allowlist | all activated channels |
| Process mgmt | foreground `npm run dev` | LaunchAgent |

## Key commands

```sh
npm run db:reset          # re-apply migrations + seed
npm run types:gen         # regenerate packages/shared/database.types.ts
npm run bridge:dev        # bridge worker in foreground
npm run web:dev           # portal
npm run functions:serve   # edge functions with env file
```
