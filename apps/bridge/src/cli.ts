import { createInterface } from "node:readline";
import { loadConfig, type BridgeConfig } from "./config";

export const DEFAULT_LOCAL_API_URL = "http://localhost:8787";
export const DEFAULT_PROD_API_URL = "https://fambot-nrogers.fly.dev";

export type BridgeTarget = "local" | "prod";

export type CliFlags = {
  target: BridgeTarget | null;
  interactive: boolean;
  apiUrl?: string;
};

export class BridgeAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
  }
}

export type BridgeIo = {
  ask(label: string): Promise<string>;
  askHidden(label: string): Promise<string>;
};

export function parseCli(argv: string[]): CliFlags {
  let target: BridgeTarget | null = null;
  let interactive = false;
  let apiUrl: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--interactive") {
      interactive = true;
      continue;
    }
    const [name, inline] = splitFlag(arg);
    if (name === "--target") {
      const value = inline ?? argv[++i];
      if (value !== "local" && value !== "prod") {
        throw new BridgeAuthError(`Unknown --target '${value ?? ""}'. Use local or prod.`);
      }
      target = value;
      continue;
    }
    if (name === "--api-url") {
      apiUrl = inline ?? argv[++i];
      if (!apiUrl) throw new BridgeAuthError("--api-url requires a URL.");
    }
  }

  return { target, interactive, apiUrl };
}

export function resolveApiUrl(
  target: BridgeTarget,
  override: string | undefined,
  env: NodeJS.ProcessEnv
): string {
  if (override?.trim()) return stripSlash(override.trim());
  if (target === "prod") return stripSlash(env.PROD_API_URL?.trim() || DEFAULT_PROD_API_URL);
  return stripSlash(env.API_URL?.trim() || DEFAULT_LOCAL_API_URL);
}

export function parseTargetInput(raw: string): BridgeTarget {
  const value = raw.trim().toLowerCase();
  if (value === "local" || value === "l" || value === "1") return "local";
  if (value === "prod" || value === "production" || value === "p" || value === "2") return "prod";
  throw new BridgeAuthError("Target must be local or prod.");
}

export function normalizeApiUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return stripSlash(trimmed);
  return stripSlash(`https://${trimmed}`);
}

export async function pingApi(
  apiUrl: string,
  fetchFn: typeof fetch = fetch
): Promise<{ service: string }> {
  let res: Response;
  try {
    res = await fetchFn(`${apiUrl}/health`);
  } catch (err) {
    throw new BridgeAuthError(
      `Could not reach ${apiUrl} (${err instanceof Error ? err.message : err}).`
    );
  }
  if (!res.ok) throw new BridgeAuthError(`Health check failed at ${apiUrl} (${res.status}).`);
  const body = (await res.json().catch(() => ({}))) as { service?: string };
  const service = body.service ?? "unknown";
  if (service !== "fambot-api") {
    throw new BridgeAuthError(
      `${apiUrl} is not a Fambot API (health service='${service}'). Set PROD_API_URL or pass --api-url.`
    );
  }
  return { service };
}

export async function loginBridge(
  apiUrl: string,
  email: string,
  password: string,
  fetchFn: typeof fetch = fetch
): Promise<{ token: string; memberId: string; user: { name: string; email: string } }> {
  const res = await fetchFn(`${apiUrl}/api/bridge/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (res.status === 401) throw new BridgeAuthError("Wrong email or password.", 401);
  if (res.status === 403) {
    throw new BridgeAuthError("Only a household owner can run the iMessage bridge.", 403);
  }
  if (!res.ok) throw new BridgeAuthError(`Login failed (${res.status}).`, res.status);
  const body = (await res.json()) as {
    token?: string;
    memberId?: string;
    user?: { name: string; email: string };
  };
  if (!body.token || !body.memberId || !body.user?.email) {
    throw new BridgeAuthError("Login response was missing bridge identity data.");
  }
  return { token: body.token, memberId: body.memberId, user: body.user };
}

export async function promptLine(label: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await new Promise((resolve) => rl.question(label, resolve));
  } finally {
    rl.close();
  }
}

export async function promptPassword(label: string): Promise<string> {
  if (!process.stdin.isTTY || !("setRawMode" in process.stdin)) {
    return promptLine(label);
  }
  process.stdout.write(label);
  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  let value = "";
  return new Promise((resolve, reject) => {
    const onData = (chunk: string | Buffer) => {
      const text = String(chunk);
      for (const char of text) {
        if (char === "\n" || char === "\r") {
          cleanup();
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          cleanup();
          process.stdout.write("\n");
          reject(new BridgeAuthError("interrupted"));
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        if (char >= " ") value += char;
      }
    };
    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    stdin.on("data", onData);
  });
}

const defaultIo: BridgeIo = {
  ask: promptLine,
  askHidden: promptPassword,
};

export async function prepareRuntime(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  deps: { io?: BridgeIo; fetchFn?: typeof fetch; log?: (msg: string) => void } = {}
): Promise<{ config: BridgeConfig; mode: "env" | BridgeTarget }> {
  const flags = parseCli(argv);
  const config = loadConfig(env);
  const io = deps.io ?? defaultIo;
  const fetchFn = deps.fetchFn ?? fetch;
  const log = deps.log ?? console.log;

  const needsLogin = Boolean(flags.target) || flags.interactive;
  if (!needsLogin) return { config, mode: "env" };

  let target = flags.target;
  if (!target) {
    target = parseTargetInput(
      await io.ask("Target [local = localhost, prod = Fly]: ")
    );
  }

  let apiUrl = resolveApiUrl(target, flags.apiUrl, env);
  if (target === "prod" && !flags.apiUrl) {
    const typed = normalizeApiUrl(await io.ask(`API URL [${apiUrl}]: `));
    if (typed) apiUrl = typed;
  }
  log(`[bridge] pinging ${target} (${apiUrl})`);
  const health = await pingApi(apiUrl, fetchFn);
  log(`[bridge] ping ok (${health.service})`);

  const email = env.BRIDGE_EMAIL?.trim() || (await io.ask("Email / username: ")).trim();
  const password = env.BRIDGE_PASSWORD ?? (await io.askHidden("Password: "));
  if (!email || !password) throw new BridgeAuthError("Email and password are required.");

  const session = await loginBridge(apiUrl, email, password, fetchFn);
  log(`[bridge] signed in as ${session.user.email}`);
  return {
    config: {
      ...config,
      API_URL: apiUrl,
      BRIDGE_TOKEN: session.token,
      BRIDGE_MEMBER_ID: session.memberId,
    },
    mode: target,
  };
}

function splitFlag(arg: string): [string, string | undefined] {
  const eq = arg.indexOf("=");
  if (eq === -1) return [arg, undefined];
  return [arg.slice(0, eq), arg.slice(eq + 1)];
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
