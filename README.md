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
- **Tasks** must be completed: at the due time the worker nudges you, then re-nudges every `nag_interval` (configurable, default 30 min) until someone replies "done" (or checks it off in the app). Recurring tasks are a *series*: each occurrence is created on its fixed schedule (for a period via `COUNT`/`UNTIL`, or forever) whether or not earlier ones are finished, and each occurrence can be postponed independently without shifting the rest.
- **Notifications broadcast to household channels, never web chat.** Scheduled reminders and task nudges go to every channel enabled in **Connections**: **SMS via Telnyx** (default — that's why every member has a phone number) and **iMessage** (opt-in, via the Mac bridge). The in-app chat is only for talking to Fambot. Members can reply to a nudge text with "done" and it completes the task — inbound SMS goes through the same pipeline as everything else. Direct and native group MMS input are accepted; for households with multiple members, conversational bot replies go to the household group MMS. Every delivery (queued/sent/delivered/failed/skipped, per recipient and channel) is recorded in the `deliveries` audit table.
- **Events** can also recur (internally expanded per date range; synced to Google Calendar as a whole series when connected).
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
  messaging/ reply router (app chat / SMS / iMessage) + NotificationDispatcher + Telnyx adapter
  calendar/  internal + Google Calendar providers (per-user OAuth, encrypted tokens)
```

## Prerequisites

| What | Why | Install |
|---|---|---|
| [Bun](https://bun.sh) ≥ 1.1 | runtime + package manager for everything | `curl -fsSL https://bun.sh/install \| bash` |
| Docker | local Postgres | [OrbStack](https://orbstack.dev) or Docker Desktop |
| [imsg](https://imsg.sh) | the iMessage relay binary | `brew install steipete/tap/imsg` |
| OpenAI API key | message interpretation (auth and CRUD still work without it) | [platform.openai.com](https://platform.openai.com/api-keys) |
| Rust toolchain | only for the native Tauri desktop build | `curl https://sh.rustup.rs \| sh` |

Optional: Google OAuth credentials (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) enable "Sign in with Google" and Google Calendar sync. Optional: a [Telnyx](https://telnyx.com) account enables SMS notifications (see below). Leave either empty and everything else still works.

## Local setup

```sh
git clone <this repo> && cd fambot
bun install

# 1. Environment
cp apps/api/.env.example apps/api/.env       # then paste your OPENAI_API_KEY
cp apps/bridge/.env.example apps/bridge/.env # defaults work for local dev

# 2. Start Postgres, apply the schema, and run every local service
bun dev
```

`bun dev` starts/reuses the `fambot-pg` Docker container, applies the current
schema, and runs the API (8787), worker, web app (5173), and (on macOS with
`imsg` installed) the iMessage bridge. It creates either `.env` file from its
example when missing. Set a non-local `DATABASE_URL` to use an existing
database instead of Docker.

Open http://localhost:5173, create an account (email/password), name your household, and you're in. Talk to Fambot in the **Chat** tab:

> remind me tomorrow at 8am to pack the kids' lunches
> make sure the trash goes out tonight
> add dinner with Jess Friday at 7 to the calendar
> what's on this week?

### Native desktop window (optional)

```sh
cd apps/desktop && bunx tauri dev    # needs the Rust toolchain
```

## SMS notifications (Telnyx)

SMS is the default notification channel: reminder fires and task nudges are texted to each member's phone number, and members can text back (e.g. reply `done` to a nudge). Without Telnyx credentials the app still runs — SMS deliveries are recorded as `skipped` in the audit table instead of being sent.

**One-time Telnyx setup:**

1. Create a [Telnyx](https://telnyx.com) account, buy a US/Canada **long-code** SMS/MMS-capable number, and create a **Messaging Profile** with that number attached. US long-code numbers need 10DLC registration for production traffic. Native group MMS does not support toll-free or short-code senders.
2. Create an API key (Account Settings → API Keys) and set `TELNYX_API_KEY` in `apps/api/.env`.
3. Run `bun dev`. When the account has exactly one profile-backed messaging
   number, the dev command discovers its number, profile, and webhook public
   key. It starts a Cloudflare quick tunnel (using `cloudflared` when installed,
   or Docker otherwise) and points that profile's v2 webhook at the local API.
4. If the account has multiple messaging numbers, also set
   `TELNYX_FROM_NUMBER`; `TELNYX_MESSAGING_PROFILE_ID` and
   `TELNYX_PUBLIC_KEY` remain available as explicit overrides.

Household group texting uses Telnyx group MMS: US/Canada `+1` wireless numbers only, up to 8 household recipients, billed as MMS per recipient. A direct member text is valid input, but Fambot replies in the native household group when at least two members have phone identities.

## Household invitations

Only the household owner can invite a member. **Settings → Members → Invite member** creates a phone-linked pending member and sends a one-time account setup link by SMS. The link expires after 7 days; the owner can resend (which invalidates the old link) or cancel it. Recipients use the existing email/password or Google sign-in, then accept the invite to link their account. An account can belong to one household.

Enable/disable the channel per household in the app under **Connections**.
Each quick-tunnel run updates the selected profile's webhook URL. To use a
stable tunnel instead, set `TELNYX_WEBHOOK_URL=https://your-tunnel.example`;
the command registers that URL and does not launch a quick tunnel. Outbound
sends work without a tunnel, but delivery receipts and inbound replies do not.

## iMessage bridge

The bridge is a dumb relay on your Mac: it tails Messages via `imsg rpc`, POSTs every relevant text to the API, and holds a WebSocket over which the API pushes outbound sends (replies, reminder fires, task nudges).

**Permissions (one-time):** the terminal app running the bridge needs
- **Full Disk Access** (to read the Messages database) — System Settings → Privacy & Security → Full Disk Access
- **Automation → Messages** (to send) — approve the prompt on first send

The bridge starts as part of `bun dev`. To run it by itself:

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
| `OPENAI_API_KEY` | For chat | interpretation model key; without it AI-backed chat returns `503` |
| `OPENAI_MODEL` | | default `gpt-5-mini` |
| `BRIDGE_TOKEN` | ✔ | shared secret with the Mac bridge |
| `BETTER_AUTH_SECRET` | ✔ | session signing (change in prod) |
| `TOKEN_ENCRYPTION_KEY` | ✔ | AES-GCM key for stored Google tokens |
| `API_BASE_URL` / `APP_URL` | ✔ | own origin / web app origin (CORS + OAuth redirects) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | | enables Google sign-in + Calendar |
| `TELNYX_API_KEY` / `TELNYX_FROM_NUMBER` | For SMS | enables the default SMS notification channel |
| `TELNYX_PUBLIC_KEY` | For SMS webhooks | verifies Telnyx webhook signatures (delivery receipts + inbound texts) |
| `TELNYX_MESSAGING_PROFILE_ID` | | pins sends and selects the profile whose webhook is updated in dev |
| `TELNYX_WEBHOOK_URL` | | stable public dev URL; otherwise `bun dev` creates a quick tunnel |

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
    TELNYX_API_KEY=... TELNYX_PUBLIC_KEY=... TELNYX_FROM_NUMBER=... \
    API_BASE_URL=https://<app>.fly.dev APP_URL=https://<vercel-domain>
  fly deploy
  ```
  Then point your Telnyx messaging profile's webhook at `https://<app>.fly.dev/api/webhooks/telnyx`.
- **Web app**: Vercel — deploy `apps/desktop` (`vercel.json` included) with `VITE_API_URL` pointing at Fly.
- **Bridge**: runs on your Mac; `deploy/launchd/app.fambot.bridge.plist` keeps it alive as a launchd agent.
