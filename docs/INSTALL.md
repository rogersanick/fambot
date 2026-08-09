# Installing FamBot on your Mac (local, end to end)

This gets you: the portal + MCP server at `http://localhost:3000`, local Supabase, and the always-on bridge riding your existing iMessage — with either **osaurus** (local models) or **Claude Code** as the agent.

## 0. Prerequisites

- macOS on Apple Silicon, signed into Messages with your Apple ID
- [Docker Desktop](https://docs.docker.com/desktop/setup/install/mac-install/) (for local Supabase) — must be running
- Node.js 24+ (`node --version`)
- [imsg](https://imsg.sh):

  ```sh
  brew install steipete/tap/imsg
  ```

- An agent (pick one, or both — switching later is one env var):
  - **osaurus** (local models, free, private): `brew install --cask osaurus`
  - **Claude Code** (big-model power): `npm install -g @anthropic-ai/claude-code` and sign in once with `claude`

## 1. One-time macOS permissions

imsg reads `~/Library/Messages/chat.db` and sends through Messages.app:

1. **Full Disk Access** for the terminal app that will run the bridge (System Settings → Privacy & Security → Full Disk Access → add Terminal/iTerm/etc). Verify: `imsg chats --limit 3` prints your recent chats.
2. **Automation**: the first time the bridge sends a message, macOS pops "…wants to control Messages" — click Allow.

## 2. Database + users

From the repo root:

```sh
npm install          # installs the supabase CLI
npm run db:start     # starts local Supabase in Docker (first run downloads images)
npm run db:reset     # applies the migration (6 tables + RLS)
npm run bootstrap    # creates owner@fambot.local and agent@fambot.local
```

`npm run bootstrap` prints both passwords (defaults: `fambot-owner` / `fambot-agent`). The **agent user** is FamBot's identity — the bridge signs in as it, and row-level security scopes everything it can touch.

## 3. Portal + MCP server

```sh
cd web
npm install
cp .env.example .env.local
```

Fill `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` — get it from `npx supabase status` (the `anon key` row). Then:

```sh
npm run dev          # http://localhost:3000
```

Set up your household (two minutes, in the browser):

1. Go to `http://localhost:3000/login`, sign in as `owner@fambot.local`.
2. Create your household (name + timezone).
3. **Settings tab → Members**: add each family member with their iMessage handle (phone in E.164 form like `+15551234567`, or the email they text from).
4. **Settings tab → Members**: add "FamBot" with account email `agent@fambot.local` — this is what lets the agent see your household.
5. **Settings tab → iMessage channels**: map your group chat. Find its GUID with:

   ```sh
   imsg chats --limit 20 --json | jq -r '.[] | [.guid, .name] | @tsv'
   ```

(Alternatively, skip 2–5 and just text `@fambot set us up` once the bridge is running — the agent can do household setup itself through the `setup_household` / `add_member` / `map_channel` tools. The portal route is more predictable with small local models.)

## 4. The agent

### Option A — osaurus (local models)

1. Launch osaurus and download a model with tool-calling support (e.g. **Qwen3 4B Instruct** or **Llama 3.2 3B Instruct**; on macOS 26+ the built-in Apple model is available as `foundation` with zero download).
2. Start the server (default port 1337): `osaurus serve` or hit Start in the app.
3. List model ids: `curl -s http://127.0.0.1:1337/v1/models | jq -r '.data[].id'`

In `bridge/.env`:

```ini
AGENT_MODE=openai
OPENAI_BASE_URL=http://127.0.0.1:1337/v1
OPENAI_MODEL=<a model id from the list, e.g. qwen3-4b-instruct-4bit or foundation>
```

The bridge drives the tool-calling loop itself: it advertises the FamBot MCP tools to the model and executes whatever the model calls. Works with anything OpenAI-compatible (LM Studio on 1234, OpenRouter, etc.) — just change `OPENAI_BASE_URL`/`OPENAI_API_KEY`.

### Option B — Claude Code

In `bridge/.env`:

```ini
AGENT_MODE=cli
AGENT_CMD=claude -p --strict-mcp-config --mcp-config "$FAMBOT_MCP_CONFIG" --allowedTools "mcp__fambot__*"
```

The bridge passes each message as a prompt on stdin and exports `FAMBOT_MCP_CONFIG` — a ready-made MCP config JSON pointing at `http://localhost:3000/mcp` with the agent's (auto-refreshed) token. Claude does its own tool calling; stdout becomes the iMessage reply.

The same contract works for any CLI: prompt on stdin, reply on stdout, `FAMBOT_MCP_URL` + `FAMBOT_MCP_TOKEN` (and `FAMBOT_MCP_CONFIG`) in env. Wrap anything you like in a script.

## 5. The bridge

```sh
cd bridge
npm install
cp .env.example .env    # if you haven't already
```

Fill in `.env`:

- `SUPABASE_ANON_KEY` — same anon key as the portal
- `CHAT_ALLOWLIST` — your group chat GUID(s), comma-separated (from `imsg chats` above)
- agent settings from step 4

Then:

```sh
npm run dev
```

You should see `Signed in to Supabase as agent@fambot.local`, `imsg ready — chat.db readable`, and `FamBot bridge is watching for messages.`

## 6. Use it

From any device — your phone, your watch, whatever — text the group chat:

- `@fambot add milk to the shopping list`
- `@fambot what's on the list?`
- `@fambot remind us thursday 5pm to take out the trash`
- `@fambot put soccer practice on the calendar saturday at 9`

Replies arrive prefixed with `Fambot says: 🤖✨` (that prefix is how the bridge tells its own messages apart from yours, since local-dev shares your iMessage identity). Reminders fire as texts within ~30 s of their time — as long as the laptop is awake. Everything is also live in the portal at `http://localhost:3000`.

Keep the Mac from sleeping while the bridge runs: System Settings → Battery → Options → "Prevent automatic sleeping on power adapter", or `caffeinate -s npm run dev`.

## Testing without iMessage

Prove the whole loop without sending a single real text:

```sh
npm run smoke:mcp    # from repo root: sign in as agent → MCP → household/task/reminder round trip
npm test             # bridge unit tests (JSON-RPC framing, filtering, both agent adapters)
```

Full pipeline dry-run with a fake imsg and a deterministic fake agent (no LLM needed):

```sh
cd bridge
env IMSG_BIN="$PWD/../scripts/fake-imsg.mjs" \
    CHAT_ALLOWLIST='iMessage;+;chat-smoke-test' \
    AGENT_MODE=cli AGENT_CMD="node $PWD/../scripts/fake-agent.mjs" \
    STATE_PATH=/tmp/fambot-fake-state.json \
    npm run dev
```

You'll see a scripted "@fambot add milk to the shopping list" arrive, the agent create the task through MCP, and the reply go out.

## Swapping agents (the whole point)

The agent seam is `AGENT_MODE` in `bridge/.env`:

- Groceries and reminders week to week → osaurus with a small local model. Private, free, instant.
- Need something smarter for a day → flip to `AGENT_MODE=cli` with Claude Code. Same tools, same household, no other changes.
- Anything else that speaks MCP or OpenAI-compatible chat → point the adapter at it.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `imsg chats` prints nothing / permission error | Full Disk Access for your terminal app, then restart the terminal |
| First reply never sends | Approve the "control Messages" Automation prompt (it may be hiding behind other windows) |
| `agent sign-in failed` at bridge startup | Supabase running? `npm run bootstrap` run? Password matches `.env`? |
| Agent replies "no household for this chat" | The chat GUID isn't mapped — portal Settings → iMessage channels, and check `CHAT_ALLOWLIST` matches exactly |
| MCP 401s | The agent user exists but the token is stale — the bridge auto-refreshes; for manual clients re-mint via sign-in |
| osaurus never calls tools | Use an instruct model with tool support (Qwen/Llama instruct builds); tiny base models often can't |
| Reminders arrive late | The Mac was asleep — they deliver on the next poll after wake |
