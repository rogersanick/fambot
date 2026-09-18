/**
 * One-command local environment: Postgres + schema + API + worker + web app,
 * with the macOS iMessage bridge. Pass --inbound-sms to expose a Cloudflare
 * tunnel and point Telnyx at this machine (steals the prod webhook).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { discoverTelnyx, registerTelnyxWebhook } from "./lib/telnyx";

const root = resolve(import.meta.dir, "..");
const apiEnvPath = resolve(root, "apps/api/.env");
const bridgeEnvPath = resolve(root, "apps/bridge/.env");
const colors = {
  setup: "\x1b[32m",
  api: "\x1b[36m",
  worker: "\x1b[33m",
  web: "\x1b[35m",
  bridge: "\x1b[34m",
  tunnel: "\x1b[90m",
};
const reset = "\x1b[0m";

function log(name: keyof typeof colors, message: string) {
  console.log(`${colors[name]}[${name}]${reset} ${message}`);
}

function parseEnv(text: string): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function commandExists(command: string) {
  return spawnSync("sh", ["-c", `command -v "$1" >/dev/null 2>&1`, "sh", command]).status === 0;
}

function run(command: string, args: string[], cwd = root, env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with status ${result.status}`);
  }
}

async function prepareDatabase(env: NodeJS.ProcessEnv) {
  const databaseUrl =
    env.DATABASE_URL ?? "postgres://postgres:fambot@localhost:5433/fambot";
  const localDefault =
    databaseUrl === "postgres://postgres:fambot@localhost:5433/fambot" ||
    databaseUrl === "postgres://postgres:fambot@127.0.0.1:5433/fambot";

  if (localDefault) {
    if (!commandExists("docker")) {
      throw new Error("Docker is required for the default local Postgres database.");
    }
    if (spawnSync("docker", ["info"], { stdio: "ignore" }).status !== 0) {
      throw new Error("Docker is installed but is not running.");
    }

    const exists =
      spawnSync("docker", ["inspect", "fambot-pg"], { stdio: "ignore" }).status === 0;
    if (exists) {
      const running = spawnSync(
        "docker",
        ["inspect", "-f", "{{.State.Running}}", "fambot-pg"],
        { encoding: "utf8" }
      ).stdout.trim();
      if (running !== "true") run("docker", ["start", "fambot-pg"]);
    } else {
      log("setup", "creating local Postgres container");
      run("docker", [
        "run",
        "-d",
        "--name",
        "fambot-pg",
        "-p",
        "5433:5432",
        "-e",
        "POSTGRES_PASSWORD=fambot",
        "-e",
        "POSTGRES_DB=fambot",
        "postgres:17-alpine",
      ]);
    }

    for (let attempt = 0; attempt < 30; attempt++) {
      if (
        spawnSync(
          "docker",
          ["exec", "fambot-pg", "pg_isready", "-U", "postgres", "-d", "fambot"],
          { stdio: "ignore" }
        ).status === 0
      ) {
        break;
      }
      if (attempt === 29) throw new Error("Postgres did not become ready.");
      await Bun.sleep(500);
    }
  } else {
    log("setup", "using DATABASE_URL from apps/api/.env");
  }

  log("setup", "applying database schema");
  run("bun", ["run", "push"], resolve(root, "packages/database"), env);
}

function telnyxTunnelCommand(port: string) {
  return `cloudflared tunnel --url http://localhost:${port}`;
}

const NGROK_URL = /https:\/\/[a-z0-9-]+\.ngrok[-a-z0-9]*\.(?:app|dev|io)/i;
const CLOUDFLARE_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

async function fillTelnyxFromAccount(env: NodeJS.ProcessEnv) {
  const apiKey = env.TELNYX_API_KEY;
  if (!apiKey) {
    log("setup", "Telnyx SMS disabled (set TELNYX_API_KEY to enable it)");
    return;
  }

  try {
    const discovered = await discoverTelnyx({
      apiKey,
      fromNumber: env.TELNYX_FROM_NUMBER,
      messagingProfileId: env.TELNYX_MESSAGING_PROFILE_ID,
      publicKey: env.TELNYX_PUBLIC_KEY,
    });
    if (discovered.publicKey) env.TELNYX_PUBLIC_KEY = discovered.publicKey;
    if (discovered.fromNumber) env.TELNYX_FROM_NUMBER = discovered.fromNumber;
    if (discovered.messagingProfileId) env.TELNYX_MESSAGING_PROFILE_ID = discovered.messagingProfileId;

    if (!env.TELNYX_FROM_NUMBER) {
      log(
        "setup",
        "No Telnyx number is attached to a messaging profile. Buy a US/Canada long-code number, attach it to a Messaging Profile, then restart bun dev.",
      );
      return;
    }
    log("setup", `Telnyx outbound SMS enabled from ${env.TELNYX_FROM_NUMBER}`);
  } catch (error) {
    log(
      "setup",
      error instanceof Error ? error.message : `Telnyx discovery failed: ${String(error)}`,
    );
  }
}

const children: Array<{ name: string; process: ChildProcess; critical: boolean }> = [];
let shuttingDown = false;
let tunnelContainer: string | null = null;

function startProcess(args: {
  name: keyof typeof colors;
  command: string;
  commandArgs: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  critical?: boolean;
  onLine?: (line: string) => void;
}) {
  const child = spawn(args.command, args.commandArgs, {
    cwd: args.cwd,
    env: args.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const prefix = `${colors[args.name]}[${args.name}]${reset} `;
  const pipe = (stream: NodeJS.ReadableStream) => {
    let buffer = "";
    stream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        console.log(prefix + line);
        args.onLine?.(line);
      }
    });
  };
  pipe(child.stdout);
  pipe(child.stderr);
  child.on("error", (error) => console.error(prefix + error.message));
  child.on("exit", (code, signal) => {
    console.log(`${prefix}exited (${signal ?? code})`);
    if (!shuttingDown && args.critical !== false) void shutdown(code || 1);
  });
  children.push({ name: args.name, process: child, critical: args.critical !== false });
  return child;
}

async function pointTelnyxWebhook(publicUrl: string, env: NodeJS.ProcessEnv) {
  const apiKey = env.TELNYX_API_KEY;
  const profileId = env.TELNYX_MESSAGING_PROFILE_ID;
  if (!apiKey || !profileId) return;
  try {
    const webhookUrl = await registerTelnyxWebhook({ apiKey, profileId, publicUrl });
    log("tunnel", `Telnyx inbound webhook configured: ${webhookUrl}`);
  } catch (error) {
    log(
      "tunnel",
      `could not configure Telnyx webhook: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function startTelnyxTunnel(env: NodeJS.ProcessEnv) {
  if (
    !env.TELNYX_API_KEY ||
    !env.TELNYX_FROM_NUMBER ||
    !env.TELNYX_PUBLIC_KEY ||
    !env.TELNYX_MESSAGING_PROFILE_ID
  ) {
    if (env.TELNYX_API_KEY) {
      log(
        "setup",
        "Inbound SMS webhook tunnel skipped until a number, messaging profile, and public key are configured.",
      );
    }
    return;
  }

  if (env.TELNYX_WEBHOOK_URL) {
    void pointTelnyxWebhook(env.TELNYX_WEBHOOK_URL, env);
    return;
  }

  const port = env.PORT ?? "8787";
  let command: string;
  let commandArgs: string[];
  let urlPattern: RegExp;
  if (commandExists("cloudflared")) {
    command = "cloudflared";
    commandArgs = ["tunnel", "--no-autoupdate", "--url", `http://localhost:${port}`];
    urlPattern = CLOUDFLARE_URL;
    log("setup", "Using a Cloudflare quick tunnel for Telnyx inbound webhooks");
  } else if (commandExists("ngrok")) {
    command = "ngrok";
    commandArgs = ["http", port, "--log", "stdout", "--log-format", "logfmt"];
    urlPattern = NGROK_URL;
    log("setup", "Using ngrok for Telnyx inbound webhooks (install cloudflared to prefer Cloudflare)");
  } else if (commandExists("docker")) {
    tunnelContainer = `fambot-tunnel-${process.pid}`;
    command = "docker";
    commandArgs = [
      "run",
      "--rm",
      "--name",
      tunnelContainer,
      "cloudflare/cloudflared:latest",
      "tunnel",
      "--no-autoupdate",
      "--url",
      `http://host.docker.internal:${port}`,
    ];
    urlPattern = CLOUDFLARE_URL;
    log("setup", "Using Docker cloudflared for Telnyx inbound webhooks");
  } else {
    log("setup", "Install cloudflared to receive inbound Telnyx texts locally: brew install cloudflared");
    log("setup", `Then run: ${telnyxTunnelCommand(port)}`);
    return;
  }

  let registered = false;
  startProcess({
    name: "tunnel",
    command,
    commandArgs,
    cwd: root,
    env,
    onLine(line) {
      if (registered) return;
      const match = line.match(urlPattern);
      if (match) {
        registered = true;
        void pointTelnyxWebhook(match[0], env);
      }
    },
  });
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.process.kill("SIGTERM");
  if (tunnelContainer) {
    spawnSync("docker", ["rm", "-f", tunnelContainer], { stdio: "ignore" });
  }
  process.exit(code);
}

async function main() {
  if (!existsSync(apiEnvPath)) {
    copyFileSync(resolve(root, "apps/api/.env.example"), apiEnvPath);
    log("setup", "created apps/api/.env from .env.example");
  }
  if (process.platform === "darwin" && !existsSync(bridgeEnvPath)) {
    copyFileSync(resolve(root, "apps/bridge/.env.example"), bridgeEnvPath);
    log("setup", "created apps/bridge/.env from .env.example");
  }

  const fileEnv = parseEnv(await Bun.file(apiEnvPath).text());
  // Explicit shell variables win over .env, matching Bun's normal precedence.
  const env = { ...fileEnv, ...process.env };
  const bridgeFileEnv = existsSync(bridgeEnvPath)
    ? parseEnv(await Bun.file(bridgeEnvPath).text())
    : {};
  // Keep bridge-only settings while forcing shared secrets to match the API.
  const bridgeEnv = { ...bridgeFileEnv, ...env };
  await prepareDatabase(env);
  await fillTelnyxFromAccount(env);

  startProcess({
    name: "api",
    command: "bun",
    commandArgs: ["--watch", "src/index.ts"],
    cwd: resolve(root, "apps/api"),
    env,
  });
  startProcess({
    name: "worker",
    command: "bun",
    commandArgs: ["--watch", "src/index.ts"],
    cwd: resolve(root, "apps/worker"),
    env,
  });
  const noWeb = process.argv.includes("--no-web");
  const noBridge = process.argv.includes("--no-bridge");
  const appUrl = new URL(env.APP_URL ?? "http://localhost:5173");
  if (noWeb) {
    log("setup", "web skipped (--no-web); start the iPhone app with bun ios");
  } else {
    startProcess({
      name: "web",
      command: "bunx",
      commandArgs: [
        "vite",
        "--host",
        appUrl.hostname,
        "--port",
        appUrl.port || (appUrl.protocol === "https:" ? "443" : "80"),
        "--strictPort",
      ],
      cwd: resolve(root, "apps/desktop"),
      env,
    });
  }

  if (noBridge) {
    log("setup", "iMessage bridge skipped (--no-bridge); run bun bridge:dev or bun bridge:prod");
  } else if (process.platform === "darwin" && commandExists(bridgeEnv.IMSG_BIN || "imsg")) {
    startProcess({
      name: "bridge",
      command: "bun",
      commandArgs: ["--watch", "src/index.ts"],
      cwd: resolve(root, "apps/bridge"),
      env: bridgeEnv,
      critical: false,
    });
  } else {
    log("setup", "iMessage bridge skipped (it requires macOS and imsg)");
  }

  const inboundSms = process.argv.includes("--inbound-sms");
  if (inboundSms) {
    startTelnyxTunnel(env);
  } else if (env.TELNYX_API_KEY) {
    log(
      "setup",
      "Telnyx inbound webhook left on production. Pass --inbound-sms to tunnel localhost (this steals the webhook from Fly).",
    );
  }
  log(
    "setup",
    noWeb
      ? `ready (backend only): API on ${env.PORT ?? "8787"} — run bun ios in another terminal`
      : `ready: ${env.APP_URL ?? "http://localhost:5173"}`
  );
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

main().catch((error) => {
  console.error(`${colors.setup}[setup]${reset} ${error instanceof Error ? error.message : error}`);
  void shutdown(1);
});
