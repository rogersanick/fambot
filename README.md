# Fambot

Fambot is your household's shared brain — reminders, tasks, lists, and a calendar the whole family talks to in plain English. Tag `@fambot` in your ordinary iMessage group chat, or use the built-in chat in the desktop/web app; either way the same pipeline interprets the message with OpenAI, executes the action, and replies in the channel you asked from.

```
iMessage ──▶ bridge (your Mac) ──▶ ┌───────────────────────────┐
                                   │  API (Bun + Hono)         │──▶ OpenAI (interpret only)
Desktop / web app ──── REST ─────▶ │  worker (fires + nudges)  │
                                   └────────────┬──────────────┘
                                                ▼
                                            Postgres
```

The LLM only ever proposes structured actions (`create_reminder`, `create_task`, `complete_task`, …) validated with Zod. Application code authorizes and executes them — the model never touches the database.

**Semantics worth knowing:**

- **Reminders** are fire-and-forget: delivered once per occurrence (one-shot or recurring), no completion state.
- **Tasks** must be completed: at the due time the worker nudges you, then re-nudges every `nag_interval` until someone replies "done" (or checks it off in the app). Recurring tasks reschedule themselves on completion.
- **Lists** are plain CRUD containers for tasks.
- Task vs reminder is inferred from context ("make sure the trash goes out" → task; "remind me the game is at 6" → reminder).

## Repo structure

```
apps/
  api/       Bun + Hono API: auth, REST, ingest webhook, message pipeline, bridge WebSocket
  worker/    reminder fires + task nag loop (atomic claims, rrule recurrence)
  bridge/    Mac iMessage relay: forwards inbound texts to the API, sends replies via imsg
  desktop/   Tauri 2 + React + Vite client (same code builds the web SPA)
packages/
  shared/    InboundMessage, ProposedAction Zod schemas, invocation matcher
  database/  Drizzle schema + migrations
  domain/    validation / authorization / resolution + reminder/task/list/event services
  ai/        AIProvider (OpenAI structured outputs, retry-on-invalid, audit logging)
  messaging/ channel router: app chat + iMessage outbox
  calendar/  internal + Google Calendar providers (per-user OAuth, encrypted tokens)
```

## Prerequisites

| What | Why | Install |
|---|---|---|
| [Bun](https://bun.sh) ≥ 1.1 | runtime + package manager for everything | `curl -fsSL https://bun.sh/install \| bash` |
| Docker | local Postgres | [OrbStack](https://orbstack.dev) or Docker Desktop |
| [imsg](https://imsg.sh) | the iMessage relay binary | `brew install steipete/tap/imsg` |
| OpenAI API key | message interpretation (**required** — API refuses to start without it) | [platform.openai.com](https://platform.openai.com/api-keys) |
| Rust toolchain | only for the native Tauri desktop build | `curl https://sh.rustup.rs \| sh` |

Optional: Google OAuth credentials (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) enable "Sign in with Google" and Google Calendar sync. Leave them empty and everything else still works (email/password auth, internal calendar).

## Local setup

```sh
git clone <this repo> && cd fambot
bun install

# 1. Postgres in Docker (port 5433 to avoid clashing with a system Postgres)
docker run -d --name fambot-pg -p 5433:5432 \
  -e POSTGRES_PASSWORD=fambot -e POSTGRES_DB=fambot postgres:17-alpine

# 2. Environment
cp apps/api/.env.example apps/api/.env       # then paste your OPENAI_API_KEY
cp apps/bridge/.env.example apps/bridge/.env # defaults work for local dev

# 3. Create the schema
bun run db:push

# 4. Run API (8787) + worker + web app (5173)
bun dev
```

Open http://localhost:5173, create an account (email/password), name your household, and you're in. Talk to Fambot in the **Chat** tab:

> remind me tomorrow at 8am to pack the kids' lunches
> make sure the trash goes out tonight
> add dinner with Jess Friday at 7 to the calendar
> what's on this week?

### Native desktop window (optional)

```sh
cd apps/desktop && bunx tauri dev    # needs the Rust toolchain
```

## iMessage bridge

The bridge is a dumb relay on your Mac: it tails Messages via `imsg rpc`, POSTs every relevant text to the API, and holds a WebSocket over which the API pushes outbound sends (replies, reminder fires, task nudges).

**Permissions (one-time):** the terminal app running the bridge needs
- **Full Disk Access** (to read the Messages database) — System Settings → Privacy & Security → Full Disk Access
- **Automation → Messages** (to send) — approve the prompt on first send

**Start it:**

```sh
bun dev:bridge
```

**Link your iMessage identity.** The API only routes texts whose sender matches a household member's iMessage handle. In the app: **Settings → household members → add member with iMessage handle**, or when you invite family members include their phone/email handle. Unknown senders are ignored (logged by the API).

**Testing from your own Apple ID:** messages you send show up as `is_from_me`, which the `production` profile skips (that's the bot echo filter). For solo testing set in `apps/bridge/.env`:

```
FAMBOT_PROFILE=local-dev
```

and give your member the iMessage handle `me`. Un-prefixed self-messages are then treated as user input. With `local-dev`, texts from *other* people work too — their handle is their phone/email as usual.

`apps/bridge/.env` reference:

| Var | Default | Meaning |
|---|---|---|
| `API_URL` | `http://localhost:8787` | where the API lives |
| `BRIDGE_TOKEN` | `dev-bridge-token` | must match the API's `BRIDGE_TOKEN` |
| `IMSG_BIN` | `imsg` | path to the imsg binary |
| `BOT_MESSAGE_PREFIX` | `Fambot says: 🤖✨` | prefix on outbound sends (also the echo filter) |
| `FAMBOT_PROFILE` | `production` | `local-dev` = treat un-prefixed self-messages as input |
| `STATE_PATH` | `./data/state.json` | replay cursor + sent-message GUIDs |

## Environment reference (`apps/api/.env`)

| Var | Required | Meaning |
|---|---|---|
| `DATABASE_URL` | ✔ | Postgres connection string |
| `OPENAI_API_KEY` | ✔ | interpretation model key |
| `OPENAI_MODEL` | | default `gpt-5-mini` |
| `BRIDGE_TOKEN` | ✔ | shared secret with the Mac bridge |
| `BETTER_AUTH_SECRET` | ✔ | session signing (change in prod) |
| `TOKEN_ENCRYPTION_KEY` | ✔ | AES-GCM key for stored Google tokens |
| `API_BASE_URL` / `APP_URL` | ✔ | own origin / web app origin (CORS + OAuth redirects) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | | enables Google sign-in + Calendar |

## Tests & typecheck

```sh
bun test           # unit tests across all workspaces
bun run typecheck  # tsc --noEmit in every workspace
```

## Deploy

- **Postgres**: [Neon](https://neon.tech) — put the connection string in `DATABASE_URL`.
- **API + worker**: [Fly.io](https://fly.io) — one app, two processes (`fly.toml` + `Dockerfile` are ready):
  ```sh
  fly launch --no-deploy
  fly secrets set DATABASE_URL=... OPENAI_API_KEY=... BRIDGE_TOKEN=... \
    BETTER_AUTH_SECRET=... TOKEN_ENCRYPTION_KEY=... \
    API_BASE_URL=https://<app>.fly.dev APP_URL=https://<vercel-domain>
  fly deploy
  ```
- **Web app**: Vercel — deploy `apps/desktop` (`vercel.json` included) with `VITE_API_URL` pointing at Fly.
- **Bridge**: runs on your Mac; `deploy/launchd/app.fambot.bridge.plist` keeps it alive as a launchd agent.
