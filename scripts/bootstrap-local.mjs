#!/usr/bin/env node
/**
 * Idempotently creates the two local-dev Supabase users:
 *   - the owner (you): signs into the portal
 *   - the agent (FamBot): the bridge signs in as this user; MCP calls run as it
 *
 * Reads keys from `npx supabase status`, so run `npm run db:start` first.
 * Override emails/passwords with OWNER_EMAIL / OWNER_PASSWORD / AGENT_EMAIL /
 * AGENT_PASSWORD env vars.
 */
import { execSync } from "node:child_process";

const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "owner@fambot.local";
const OWNER_PASSWORD = process.env.OWNER_PASSWORD ?? "fambot-owner";
const AGENT_EMAIL = process.env.AGENT_EMAIL ?? "agent@fambot.local";
const AGENT_PASSWORD = process.env.AGENT_PASSWORD ?? "fambot-agent";

function supabaseStatus() {
  const out = execSync("npx supabase status -o env", { encoding: "utf8" });
  const env = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

async function createUser(apiUrl, serviceKey, email, password) {
  const res = await fetch(`${apiUrl}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await res.json();
  if (res.ok) return { email, status: "created", id: body.id };
  const msg = body.msg ?? body.message ?? JSON.stringify(body);
  if (res.status === 422 || /already/i.test(String(msg))) return { email, status: "exists" };
  throw new Error(`creating ${email} failed (${res.status}): ${msg}`);
}

const status = supabaseStatus();
const apiUrl = status.API_URL ?? "http://127.0.0.1:54321";
const serviceKey = status.SERVICE_ROLE_KEY;
if (!serviceKey) {
  console.error("Could not read SERVICE_ROLE_KEY from `npx supabase status` — is Supabase running?");
  process.exit(1);
}

const owner = await createUser(apiUrl, serviceKey, OWNER_EMAIL, OWNER_PASSWORD);
const agent = await createUser(apiUrl, serviceKey, AGENT_EMAIL, AGENT_PASSWORD);

console.log(`owner  ${owner.email}  (${owner.status})  password: ${OWNER_PASSWORD}`);
console.log(`agent  ${agent.email}  (${agent.status})  password: ${AGENT_PASSWORD}`);
console.log(`
Next steps:
  1. Portal:  http://localhost:3000/login — sign in as ${OWNER_EMAIL} and create your household.
  2. In Settings → Members, add "FamBot" with account email ${AGENT_EMAIL} so the agent can
     see the household. (Skip both steps if you let the agent set up from chat instead.)
  3. Bridge:  put AGENT_EMAIL/AGENT_PASSWORD in bridge/.env — the bridge signs in as the agent.`);
