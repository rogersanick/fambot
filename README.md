# Fambot

Fambot is your household's shared brain — reminders, tasks, lists, and a calendar the whole family talks to in plain English. Tag `@fambot` in your ordinary iMessage group chat, or use the built-in chat in the desktop/web app; either way the same pipeline interprets the message with OpenAI, executes the action, and replies in the channel you asked from.

```
iMessage ──▶ bridge (your Mac) ──▶ ┌───────────────────────────┐
                                   │  API (Bun + Hono)         │──▶ OpenAI (interpret only)
Desktop / web app ──── REST ─────▶ │  worker (fires reminders) │
                                   └────────────┬──────────────┘
                                                ▼
                                            Postgres
```

The LLM only ever proposes structured actions (`create_reminder`, `create_task`, `complete_task`, …) validated with Zod. Application code authorizes and executes them — the model never touches the database.

**Semantics worth knowing:**

- **Events** happen at a time. They are not completable. They can have reminders and linked tasks, and they can recur (expanded on read; synced to Google Calendar as a whole series when connected).
- **Tasks** are obligations that stay open until someone completes them. A due date is optional and is not a notification. Recurring tasks are a *series*: each occurrence is created on its fixed schedule and can be postponed independently.
- **Lists** are checklists. Items check and uncheck only — they are never tasks. Standing household lists (groceries, packing) need no parent. A list can optionally attach to a Task, an Event, or both (packing for a trip that also has a “pack the car” task).
- **Reminders** are notification schedules. Most attach to one Task or Event (never both); a one-off reminder with no parent is allowed. On a Task they may repeat until the task is completed (“remind me every 4 hours”). Completing a task cancels its remaining reminders.
- **Notifications broadcast to household channels, never web chat.** Scheduled reminders go to every channel enabled in **Connections**: **SMS via Telnyx** (default — that's why every member has a phone number) and **iMessage** (opt-in, via the Mac bridge). The in-app chat is only for talking to Fambot. Members can reply to a task reminder with "done" and it completes the task. Every delivery is recorded in the `deliveries` audit table.

## Repo structure

```
apps/
  api/       Bun + Hono API: auth, REST, ingest webhook, message pipeline, bridge WebSocket
  worker/    reminder fire loop (atomic claims, rrule recurrence, until-completed tasks)
  bridge/    Mac iMessage relay: forwards inbound texts to the API, sends replies via imsg
  desktop/   Tauri 2 + React + Vite client (web SPA, desktop window, iPhone)
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
| Rust toolchain | native Tauri desktop + iPhone builds | `curl https://sh.rustup.rs \| sh` |
| Xcode + CocoaPods | iPhone Simulator / device (macOS only) | Mac App Store, then `brew install cocoapods` |

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
database instead of Docker. Pass `--no-web` to skip Vite, or `--no-bridge` to
skip the Mac relay (then run `bun bridge:local` or `bun bridge:prod` yourself).

Open http://localhost:5173, create an account (email/password), name your household, and you're in. Talk to Fambot in the **Chat** tab:

> remind me tomorrow at 8am to pack the kids' lunches
> make sure the trash goes out tonight
> add dinner with Jess Friday at 7 to the calendar
> what's on this week?

### Native desktop window (optional)

```sh
cd apps/desktop && bunx tauri dev    # needs the Rust toolchain
```

### iPhone (Tauri)

The same React app runs in a Tauri 2 WKWebView. Below the `md` breakpoint the dashboard uses a compact header, hides the terminal hero, and a bottom bar (**Overview, Chat, Tasks, Calendar, More**). All eight features stay available.

**One-time setup** (macOS + full Xcode, not just Command Line Tools):

```sh
bun ios:init
```

That adds the Rust iOS targets and generates the Xcode project under `apps/desktop/src-tauri/gen/` (gitignored). Sign with your Apple team via `APPLE_DEVELOPMENT_TEAM` — do not commit a team ID.

**Daily local loop** — do not run `bun dev` at the same time; both want Vite on port 5173.

```sh
bun dev:ios          # Postgres + API + worker (no Vite)
bun ios              # Vite + iPhone Simulator
# or
bun ios:device       # Vite on the LAN + physical iPhone
bun ios:open         # same, but opens Xcode
```

`bun ios:device` sets `TAURI_DEV_HOST` so Vite (and HMR) are reachable from the phone. The `/api` proxy still forwards to `localhost:8787`, so session cookies stay first-party.

**Build an IPA:**

```sh
bun ios:build        # needs Xcode signing / APPLE_DEVELOPMENT_TEAM
```

Inspect the webview from Safari → Develop → [Simulator or device] → localhost.

A shipped IPA would set `VITE_API_URL` to a public API. Cross-origin cookies from Tauri's custom-scheme webview are a follow-up; the local loop above does not need that.

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

The bridge starts as part of `bun dev` using `BRIDGE_TOKEN` from env (no prompt). To run it by itself as a household owner — locally or against the deployed API:

```sh
bun bridge            # asks local vs prod, then email/password
bun bridge:local      # ping http://localhost:8787, then sign in
bun bridge:prod       # asks for the deployed API URL, pings it, then sign in
```

Only a household owner can authenticate. The CLI pings `/health` and checks that the host is a Fambot API before asking for a password. `bun bridge:prod` suggests `PROD_API_URL` (default `https://fambot.fly.dev`) and lets you override it. Don't run `bun bridge:prod` alongside `bun dev`'s local bridge — one Mac should relay to one API. Use `bun dev --no-bridge` if you want the local API/web without starting the relay.

**Link your iMessage identity.** The API only routes texts whose sender matches a household member's iMessage handle (phone or Apple ID email). In the app: **Settings → household members → add member with iMessage handle**, or when you invite family members include their phone/email handle. Unknown senders are ignored (logged by the API). Messages you send from the bridge Mac are forwarded like anyone else's; the bridge drops only its own echoes (the outbound prefix, or a GUID it just sent).

`apps/bridge/.env` reference:

| Var | Default | Meaning |
|---|---|---|
| `API_URL` | `http://localhost:8787` | local API (`bun dev` and `bun bridge:local`) |
| `PROD_API_URL` | `https://fambot.fly.dev` | deployed API (`bun bridge:prod`) |
| `BRIDGE_TOKEN` | `dev-bridge-token` | used by `bun dev`; interactive commands fetch this after owner login |
| `BRIDGE_EMAIL` / `BRIDGE_PASSWORD` | | optional non-interactive login for `bun bridge:*` |
| `IMSG_BIN` | `imsg` | path to the imsg binary |
| `BOT_MESSAGE_PREFIX` | `Fambot says: 🤖✨` | prefix on outbound sends (also the echo filter) |
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
