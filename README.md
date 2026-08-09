# FamBot

FamBot is your household's shared brain — todos, calendar, and reminders — that the whole family talks to by tagging `@fambot` in your ordinary iMessage group chat.

The design is **maximally extensible, minimally scoped**:

- **The app** is a Supabase-powered Next.js portal. It exposes everything it can do as **MCP tools** at `/mcp`. That's the whole product.
- **The bridge** is the simplest possible always-on process on your Mac. It piggybacks on your existing iMessage identity via [imsg](https://imsg.sh), and when someone tags `@fambot` it invokes *your* agent, then texts the agent's reply back. It also delivers due reminders.
- **The agent is pluggable.** Anything that can call MCP tools works: [osaurus](https://osaurus.ai) with local/Apple models, Claude Code when you want big-model power, or any OpenAI-compatible endpoint. Swap agents by editing one env var — the app never contains an LLM pipeline.

```
iMessage ──▶ bridge (Mac, always on) ──▶ your agent ──▶ MCP tools ──▶ Supabase
   ▲              │                          │                          ▲
   └── reply ─────┘                          └──────── RLS-scoped ──────┘
```

Auth is boring on purpose: the agent is a real Supabase user and a household *member* with role `agent`. Its MCP calls carry its JWT, and Postgres row-level security is the only authorization layer.

## Repo structure

```
fambot/
  web/       # Next.js portal (todos/calendar/reminders UI) + MCP server at /mcp
  bridge/    # Mac bridge: supervised `imsg rpc` child, agent adapters, reminder poller
  supabase/  # one migration (6 tables + RLS + 2 RPCs), config for local stack
  scripts/   # bootstrap-local, mcp-smoke, fake-imsg + fake-agent (test without Messages)
  docs/      # INSTALL.md (start here), design spec
```

## Quickstart

Full walkthrough with permissions and agent setup: **[docs/INSTALL.md](docs/INSTALL.md)**.

```sh
npm install                     # root tooling (supabase CLI)
npm run db:start                # local Supabase (Docker)
npm run db:reset                # apply migration
npm run bootstrap               # create owner + agent users

cd web && npm install && cp .env.example .env.local   # fill anon key
npm run dev                     # portal + MCP at http://localhost:3000

cd ../bridge && npm install && cp .env.example .env   # fill allowlist + agent
npm run dev                     # the always-on bridge
```

Verify without touching iMessage at all:

```sh
npm run smoke:mcp               # agent-perspective MCP round trip
npm test                        # bridge unit tests (fakes only)
```

## The MCP surface

15 tools: `get_context`, `setup_household`, `add_member`, `list_members`, `map_channel`, `create_task`, `list_tasks`, `update_task`, `create_event`, `list_events`, `update_event`, `delete_event`, `create_reminder`, `list_reminders`, `cancel_reminder`.

Any MCP client can use them — point it at `http://localhost:3000/mcp` with an `Authorization: Bearer <supabase-jwt>` header. This is also how you'd plug in a *different* messaging channel later: the channel just needs to get an agent invoked with tools.

## Schema

Six tables: `households`, `members`, `channels` (iMessage chat ↔ household), `tasks`, `events`, `reminders`. RLS everywhere; household bootstrap and email-based member linking go through two security-definer RPCs (`setup_household`, `add_member_with_email`).
