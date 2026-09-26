import { beforeAll, describe, expect, test } from "bun:test";
import { ApnsClient, normalizeApnsPrivateKey, type ApnsTransport } from "./apns";

/** In-memory P-256 key pair standing in for the Apple-issued .p8. */
let privateKeyPem: string;
let publicKey: CryptoKey;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  publicKey = pair.publicKey;
  const pkcs8 = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.toString("base64")}\n-----END PRIVATE KEY-----`;
});

type Recorded = { host: string; path: string; headers: Record<string, string>; body: string };

function fakeTransport(
  respond: (req: Recorded) => { status: number; headers?: Record<string, string>; body?: string }
) {
  const requests: Recorded[] = [];
  const transport: ApnsTransport = async (args) => {
    requests.push(args);
    const res = respond(args);
    return { status: res.status, headers: res.headers ?? {}, body: res.body ?? "" };
  };
  return { transport, requests };
}

function makeClient(transport: ApnsTransport) {
  return new ApnsClient({
    teamId: "TEAM123456",
    keyId: "KEY1234567",
    bundleId: "app.fambot.desktop",
    privateKey: privateKeyPem,
    transport,
  });
}

function b64urlToBuf(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64"));
}

describe("normalizeApnsPrivateKey", () => {
  test("accepts raw PEM, escaped-newline PEM, and base64-wrapped PEM", () => {
    expect(normalizeApnsPrivateKey(privateKeyPem)).toContain("BEGIN PRIVATE KEY");
    expect(normalizeApnsPrivateKey(privateKeyPem.replaceAll("\n", "\\n"))).toContain(
      "BEGIN PRIVATE KEY"
    );
    const base64 = Buffer.from(privateKeyPem, "utf8").toString("base64");
    expect(normalizeApnsPrivateKey(base64)).toContain("BEGIN PRIVATE KEY");
    expect(() => normalizeApnsPrivateKey("not-a-key")).toThrow();
  });
});

describe("ApnsClient", () => {
  test("sends a signed, well-formed alert to the right host per environment", async () => {
    const { transport, requests } = fakeTransport(() => ({
      status: 200,
      headers: { "apns-id": "abc-123" },
    }));
    const client = makeClient(transport);

    const sandbox = await client.send({
      token: "aa11",
      environment: "sandbox",
      title: "Fambot",
      body: "hello",
      data: { type: "task", id: "0f0e0d0c-0b0a-4908-8706-050403020100" },
    });
    const production = await client.send({
      token: "bb22",
      environment: "production",
      title: "Fambot",
      body: "hello again",
    });

    expect(sandbox).toEqual({ ok: true, apnsId: "abc-123" });
    expect(production.ok).toBe(true);
    expect(requests[0]!.host).toBe("api.sandbox.push.apple.com");
    expect(requests[1]!.host).toBe("api.push.apple.com");
    expect(requests[0]!.path).toBe("/3/device/aa11");
    expect(requests[0]!.headers["apns-topic"]).toBe("app.fambot.desktop");
    expect(requests[0]!.headers["apns-push-type"]).toBe("alert");

    const payload = JSON.parse(requests[0]!.body) as Record<string, unknown>;
    expect(payload.aps).toEqual({ alert: { title: "Fambot", body: "hello" }, sound: "default" });
    expect(payload.type).toBe("task");
    expect(payload.id).toBe("0f0e0d0c-0b0a-4908-8706-050403020100");
  });

  test("provider JWT is a valid ES256 token with team/key claims, cached across sends", async () => {
    const { transport, requests } = fakeTransport(() => ({ status: 200 }));
    const client = makeClient(transport);
    await client.send({ token: "t1", environment: "sandbox", title: "a", body: "b" });
    await client.send({ token: "t2", environment: "sandbox", title: "c", body: "d" });

    const auth1 = requests[0]!.headers.authorization!;
    const auth2 = requests[1]!.headers.authorization!;
    expect(auth1).toBe(auth2); // cached, not re-signed per send

    const jwt = auth1.replace(/^bearer /, "");
    const [header, claims, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(b64urlToBuf(header!)).toString())).toEqual({
      alg: "ES256",
      kid: "KEY1234567",
    });
    const parsedClaims = JSON.parse(Buffer.from(b64urlToBuf(claims!)).toString());
    expect(parsedClaims.iss).toBe("TEAM123456");
    expect(typeof parsedClaims.iat).toBe("number");

    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      b64urlToBuf(signature!),
      new TextEncoder().encode(`${header}.${claims}`)
    );
    expect(valid).toBe(true);
  });

  test("classifies permanent token failures vs transient errors", async () => {
    const respondWith = (status: number, reason: string) =>
      fakeTransport(() => ({ status, body: JSON.stringify({ reason }) }));

    for (const [status, reason] of [
      [410, "Unregistered"],
      [400, "BadDeviceToken"],
      [400, "DeviceTokenNotForTopic"],
    ] as const) {
      const { transport } = respondWith(status, reason);
      const result = await makeClient(transport).send({
        token: "dead",
        environment: "sandbox",
        title: "x",
        body: "y",
      });
      expect(result).toEqual({ ok: false, status, reason, tokenInvalid: true });
    }

    const { transport } = respondWith(503, "ServiceUnavailable");
    const transient = await makeClient(transport).send({
      token: "fine",
      environment: "sandbox",
      title: "x",
      body: "y",
    });
    expect(transient.ok).toBe(false);
    if (!transient.ok) expect(transient.tokenInvalid).toBe(false);
  });

  test("an expired provider JWT is dropped from the cache and re-signed", async () => {
    let calls = 0;
    const { transport, requests } = fakeTransport(() => {
      calls++;
      return calls === 1
        ? { status: 403, body: JSON.stringify({ reason: "ExpiredProviderToken" }) }
        : { status: 200 };
    });
    const client = makeClient(transport);
    const first = await client.send({ token: "t", environment: "sandbox", title: "a", body: "b" });
    expect(first.ok).toBe(false);
    // Force iat to differ so a re-sign produces a different token.
    await new Promise((r) => setTimeout(r, 1100));
    const second = await client.send({ token: "t", environment: "sandbox", title: "a", body: "b" });
    expect(second.ok).toBe(true);
    expect(requests[0]!.headers.authorization).not.toBe(requests[1]!.headers.authorization);
  });
});
