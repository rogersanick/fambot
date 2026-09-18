/**
 * Production Fly helpers.
 *
 *   bun run prod:up       create app if missing, secrets, deploy, scale, Telnyx webhook
 *   bun run prod:secrets  fly secrets import from .env.fly
 *   bun run prod:deploy   fly deploy
 *   bun run prod:telnyx   point Telnyx inbound webhook at Fly
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { commandExists } from "./lib/neon";
import { readEnvFile } from "./lib/env-file";
import { flyAppName, prodApiUrl } from "./lib/fly-app";
import { registerTelnyxWebhook } from "./lib/telnyx";

const root = resolve(import.meta.dir, "..");
const APP = flyAppName();
const PROD_API_URL = prodApiUrl(APP);
const flyEnvPath = resolve(root, ".env.fly");
const apiProdPath = resolve(root, "apps/api/.env.prod");

function log(message: string) {
  console.log(`[prod] ${message}`);
}

function fail(message: string): never {
  console.error(`[prod] ${message}`);
  process.exit(1);
}

function fly(args: string[], opts: { inherit?: boolean; input?: string } = {}) {
  if (!commandExists("fly") && !commandExists("flyctl")) {
    fail("flyctl is not installed. Install it from https://fly.io/docs/flyctl/install/ then run `fly auth login`.");
  }
  const bin = commandExists("fly") ? "fly" : "flyctl";
  const stdio = opts.input ? (["pipe", "inherit", "inherit"] as const) : opts.inherit ? "inherit" : (["pipe", "pipe", "pipe"] as const);
  const result = spawnSync(bin, args, {
    cwd: root,
    encoding: "utf8",
    input: opts.input,
    stdio,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    throw new Error(`fly ${args.join(" ")} failed${detail ? `:\n${detail}` : ` (exit ${result.status})`}`);
  }
  return (result.stdout ?? "").trim();
}

function appExists(): boolean {
  const result = spawnSync(commandExists("fly") ? "fly" : "flyctl", ["apps", "list", "--json"], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || "").trim();
    fail(`Could not list Fly apps. Run \`fly auth login\`.\n${detail}`);
  }
  const parsed = JSON.parse(result.stdout || "[]") as Array<{ Name?: string; name?: string; ID?: string }>;
  return parsed.some((app) => (app.Name || app.name || app.ID) === APP);
}

function ensureApp() {
  if (appExists()) {
    log(`Fly app ${APP} already exists`);
    return;
  }
  log(`creating Fly app ${APP}`);
  fly(["apps", "create", APP], { inherit: true });
}

function secretsFile(): string {
  if (!existsSync(flyEnvPath)) {
    fail("Missing .env.fly. Run `bun run env:setup` first.");
  }
  return flyEnvPath;
}

async function importSecrets() {
  const path = secretsFile();
  const env = await readEnvFile(path);
  const lines = Object.entries(env)
    .filter(([, value]) => value.trim() !== "")
    .map(([key, value]) => `${key}=${value}`);
  if (lines.length === 0) fail(".env.fly has no non-empty secrets.");
  log(`importing ${lines.length} secret(s) to Fly`);
  fly(["secrets", "import", "--app", APP], { inherit: true, input: `${lines.join("\n")}\n` });
}

function deploy() {
  log("deploying");
  fly(["deploy"], { inherit: true });
}

function processGroup(machine: Record<string, any>): string {
  return (
    machine.process_group ||
    machine.config?.metadata?.fly_process_group ||
    machine.config?.metadata?.["fly_process_group"] ||
    ""
  );
}

function ensureWorkerRunning() {
  log("ensuring a worker machine is running");
  const raw = fly(["machines", "list", "--app", APP, "--json"]);
  const machines = JSON.parse(raw || "[]") as Array<Record<string, any>>;
  const workers = machines.filter((machine) => processGroup(machine) === "worker");
  if (workers.some((machine) => machine.state === "started")) {
    log("worker already running");
    return;
  }
  const stopped = workers.find((machine) => machine.state === "stopped" || machine.state === "created");
  if (stopped?.id) {
    fly(["machine", "start", stopped.id, "--app", APP], { inherit: true });
    return;
  }
  fly(["scale", "count", "1", "--process-group", "worker", "--app", APP, "--yes"], { inherit: true });
}

async function telnyxWebhook() {
  const env = await readEnvFile(existsSync(apiProdPath) ? apiProdPath : flyEnvPath);
  const apiKey = env.TELNYX_API_KEY;
  const profileId = env.TELNYX_MESSAGING_PROFILE_ID;
  if (!apiKey || !profileId) {
    log("Telnyx webhook skipped (TELNYX_API_KEY / TELNYX_MESSAGING_PROFILE_ID missing)");
    return;
  }
  const webhookUrl = await registerTelnyxWebhook({
    apiKey,
    profileId,
    publicUrl: PROD_API_URL,
  });
  log(`Telnyx inbound webhook → ${webhookUrl}`);
}

async function up() {
  ensureApp();
  await importSecrets();
  deploy();
  ensureWorkerRunning();
  await telnyxWebhook();
  log(`API health: ${PROD_API_URL}/health`);
}

const command = process.argv[2] ?? "up";

const run = async () => {
  if (command === "up") await up();
  else if (command === "secrets") {
    ensureApp();
    await importSecrets();
  } else if (command === "deploy") deploy();
  else if (command === "telnyx") await telnyxWebhook();
  else fail(`Unknown command '${command}'. Use up | secrets | deploy | telnyx.`);
};

run().catch((error) => {
  console.error(`[prod] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
