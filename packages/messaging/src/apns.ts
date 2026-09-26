/**
 * Minimal APNs provider client (token-based auth, HTTP/2).
 *
 * - Auth: ES256 provider JWT signed with the `.p8` key from the Apple
 *   Developer portal; cached ~45 minutes (Apple requires 20–60).
 * - Transport: injectable; the default uses node:http2 because APNs only
 *   speaks HTTP/2. Tests pass a fake transport.
 * - Environment is per *send*, not per client: dev-signed installs carry
 *   sandbox tokens even when the app talks to the production API, so the
 *   caller passes each device row's stored environment.
 *
 * APNs has no idempotency key; callers must dedupe at the database level
 * (deliveries.dedupeKey) before invoking `send`, exactly like Telnyx.
 */
import { connect } from "node:http2";

export type ApnsEnvironment = "sandbox" | "production";

export type ApnsConfig = {
  teamId: string;
  keyId: string;
  /** apns-topic — must equal the app's bundle identifier. */
  bundleId: string;
  /** PKCS#8 `.p8` contents: raw PEM (possibly with literal \n) or base64 of the PEM. */
  privateKey: string;
  /** Injectable for tests. */
  transport?: ApnsTransport;
};

export type ApnsTransport = (args: {
  host: string;
  path: string;
  headers: Record<string, string>;
  body: string;
}) => Promise<{ status: number; headers: Record<string, string>; body: string }>;

export type ApnsSendResult =
  | { ok: true; apnsId: string }
  | {
      ok: false;
      status: number;
      reason: string;
      /** APNs says this device token is permanently dead — deactivate it. */
      tokenInvalid: boolean;
    };

const HOSTS: Record<ApnsEnvironment, string> = {
  production: "api.push.apple.com",
  sandbox: "api.sandbox.push.apple.com",
};

/** APNs reasons that mean the token itself will never work again. */
const TOKEN_INVALID_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

/** Accepts raw PEM, PEM with literal "\n" escapes, or base64-wrapped PEM. */
export function normalizeApnsPrivateKey(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes("BEGIN PRIVATE KEY")) return trimmed.replaceAll("\\n", "\n");
  const decoded = Buffer.from(trimmed, "base64").toString("utf8");
  if (decoded.includes("BEGIN PRIVATE KEY")) return decoded;
  throw new Error("APNS_PRIVATE_KEY is not a PKCS#8 PEM (raw or base64-encoded)");
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const raw = Buffer.from(body, "base64");
  return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
}

function base64url(data: Uint8Array | string): string {
  const buf = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data);
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const defaultTransport: ApnsTransport = (args) =>
  new Promise((resolve, reject) => {
    const client = connect(`https://${args.host}`);
    client.on("error", (err) => {
      client.close();
      reject(err);
    });
    const req = client.request({ ":method": "POST", ":path": args.path, ...args.headers });
    let body = "";
    let status = 0;
    const headers: Record<string, string> = {};
    req.on("response", (h) => {
      status = Number(h[":status"] ?? 0);
      for (const [key, value] of Object.entries(h)) {
        if (!key.startsWith(":") && value != null) headers[key] = String(value);
      }
    });
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => (body += chunk));
    req.on("end", () => {
      client.close();
      resolve({ status, headers, body });
    });
    req.on("error", (err) => {
      client.close();
      reject(err);
    });
    req.end(args.body);
  });

/** Provider JWTs are valid 20–60 minutes; refresh comfortably inside that. */
const JWT_TTL_MS = 45 * 60 * 1000;

export class ApnsClient {
  private jwt: { value: string; issuedAt: number } | null = null;
  private keyPromise: Promise<CryptoKey> | null = null;

  constructor(private config: ApnsConfig) {}

  private importKey(): Promise<CryptoKey> {
    this.keyPromise ??= crypto.subtle.importKey(
      "pkcs8",
      pemToDer(normalizeApnsPrivateKey(this.config.privateKey)),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );
    return this.keyPromise;
  }

  private async providerJwt(): Promise<string> {
    if (this.jwt && Date.now() - this.jwt.issuedAt < JWT_TTL_MS) return this.jwt.value;
    const key = await this.importKey();
    const header = base64url(JSON.stringify({ alg: "ES256", kid: this.config.keyId }));
    const claims = base64url(
      JSON.stringify({ iss: this.config.teamId, iat: Math.floor(Date.now() / 1000) })
    );
    const signingInput = `${header}.${claims}`;
    // WebCrypto ECDSA yields the raw r||s form JWT ES256 requires.
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      new TextEncoder().encode(signingInput)
    );
    const value = `${signingInput}.${base64url(new Uint8Array(signature))}`;
    this.jwt = { value, issuedAt: Date.now() };
    return value;
  }

  async send(args: {
    token: string;
    environment: ApnsEnvironment;
    title: string;
    body: string;
    /** Custom keys delivered to the app alongside the alert (deep links). */
    data?: Record<string, string>;
  }): Promise<ApnsSendResult> {
    const transport = this.config.transport ?? defaultTransport;
    const payload = JSON.stringify({
      aps: { alert: { title: args.title, body: args.body }, sound: "default" },
      ...(args.data ?? {}),
    });
    const res = await transport({
      host: HOSTS[args.environment],
      path: `/3/device/${args.token}`,
      headers: {
        authorization: `bearer ${await this.providerJwt()}`,
        "apns-topic": this.config.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      },
      body: payload,
    });
    if (res.status === 200) {
      return { ok: true, apnsId: res.headers["apns-id"] ?? "" };
    }
    let reason = `apns ${res.status}`;
    try {
      const parsed = JSON.parse(res.body) as { reason?: string };
      if (parsed.reason) reason = parsed.reason;
    } catch {
      // keep the status-based reason
    }
    // A stale provider JWT is our problem, not the token's; drop the cache so
    // the next occurrence signs fresh.
    if (reason === "ExpiredProviderToken") this.jwt = null;
    return { ok: false, status: res.status, reason, tokenInvalid: TOKEN_INVALID_REASONS.has(reason) };
  }
}
