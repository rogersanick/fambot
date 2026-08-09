# Task plan: agent core

Pipeline inside `ingest-message`: the LLM proposes, deterministic code disposes.

## Modules (`supabase/functions/_shared/agent/`)

- `types.ts` — the 17 allowed intents, the strict structured-output JSON schema, `AgentContext`.
- `time.ts` — household-timezone helpers: named-window snapping (morning/afternoon/evening per household; tonight 20:00 / end-of-day 18:00 fixed), human formatting ("Today, 6:00 PM").
- `deeplink.ts` — per-intent URL selection from `APP_BASE_URL` + slug + short codes.
- `context.ts` — resolve channel → household → sender member (upserting unknown senders into the roster); load timezone/defaults, roster with aliases, open tasks, 14 days of events, the open clarification, and FamBot's recent outbox lines; verify bridge context turns (same chat, ≤8, ≤10 min, ends with invoking message) — used for inference only, never persisted.
- `llm.ts` — OpenAI-compatible chat-completions call with `response_format: json_schema (strict)`; provider/base URL/model from env (Osaurus-ready seam); records into `bot_runs`.
- `validator.ts` — deterministic: intent allowed for household state; pronoun resolution (me → sender, we → unassigned, you → other member only with exactly 2, names/aliases exact); date plausibility + named-window snapping; target resolution to exactly one row; bulk deletes require a confirmation round-trip; model IDs ignored. Ambiguity → clarification, never a guess.
- `executor.ts` — one postgres.js transaction per action: `set_config('fambot.actor_*')` for audit attribution, typed domain functions (createTask, completeTask, …), reminder row maintenance, outbox insert with semantic dedupe key.
- `composer.ts` — interaction-style rules: ✓ confirmations ≤3 lines, disclosed defaults, one clarification question ending with "Reply with @fambot", compact bullet lists capped at 10, exactly one deep link as the last line.
- `onboarding.ts` — unknown-channel greeting, SETUP, timezone capture, HELP, STOP (+ outbox suppression), LINK code minting; deterministic quick-intent regexes run before the LLM.
- `run.ts` — orchestration + clarification lifecycle (supersede-on-new-question, answer merge, cancel, 24 h expiry handled by cron).
