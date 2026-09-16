import { describe, expect, test } from "bun:test";
import {
  BridgeAuthError,
  loginBridge,
  normalizeApiUrl,
  parseCli,
  parseTargetInput,
  pingApi,
  prepareRuntime,
  resolveApiUrl,
} from "./cli";

describe("parseCli", () => {
  test("reads --target and --api-url in both forms", () => {
    expect(parseCli(["--target", "prod", "--api-url", "https://example.test"])).toEqual({
      target: "prod",
      interactive: false,
      apiUrl: "https://example.test",
    });
    expect(parseCli(["--target=local", "--interactive"])).toEqual({
      target: "local",
      interactive: true,
      apiUrl: undefined,
    });
  });

  test("rejects unknown targets", () => {
    expect(() => parseCli(["--target", "staging"])).toThrow(/local or prod/);
  });
});

describe("resolveApiUrl", () => {
  test("uses local/prod defaults and env/override precedence", () => {
    expect(resolveApiUrl("local", undefined, {})).toBe("http://localhost:8787");
    expect(resolveApiUrl("prod", undefined, {})).toBe("https://fambot.fly.dev");
    expect(resolveApiUrl("local", undefined, { API_URL: "http://127.0.0.1:8787/" })).toBe(
      "http://127.0.0.1:8787"
    );
    expect(resolveApiUrl("prod", undefined, { PROD_API_URL: "https://fambot.example/" })).toBe(
      "https://fambot.example"
    );
    expect(resolveApiUrl("prod", "https://override.test/", { PROD_API_URL: "https://ignored" })).toBe(
      "https://override.test"
    );
  });
});

describe("parseTargetInput", () => {
  test("accepts local/prod aliases", () => {
    expect(parseTargetInput("LOCAL")).toBe("local");
    expect(parseTargetInput("p")).toBe("prod");
    expect(parseTargetInput("2")).toBe("prod");
    expect(() => parseTargetInput("fly")).toThrow(/local or prod/);
  });
});

describe("normalizeApiUrl", () => {
  test("adds https and strips trailing slashes", () => {
    expect(normalizeApiUrl("https://api.example.test/")).toBe("https://api.example.test");
    expect(normalizeApiUrl("fambot.example.test")).toBe("https://fambot.example.test");
    expect(normalizeApiUrl("  ")).toBe("");
  });
});

describe("pingApi / loginBridge", () => {
  test("pingApi reads /health and requires the fambot-api service", async () => {
    const fetchFn = (async (url: string | URL | Request) => {
      expect(String(url)).toBe("https://api.example.test/health");
      return Response.json({ ok: true, service: "fambot-api" });
    }) as typeof fetch;
    await expect(pingApi("https://api.example.test", fetchFn)).resolves.toEqual({
      service: "fambot-api",
    });

    const wrong = (async (_url: string | URL | Request) =>
      Response.json({ service: "whatsapp-bridge", status: "healthy" })) as typeof fetch;
    await expect(pingApi("https://fambot.fly.dev", wrong)).rejects.toThrow(/not a Fambot API/);
  });

  test("loginBridge posts credentials and maps auth failures", async () => {
    const fetchFn = (async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        email: "nick@example.com",
        password: "secret",
      });
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }) as typeof fetch;
    await expect(loginBridge("http://api.test", "nick@example.com", "secret", fetchFn)).rejects.toThrow(
      BridgeAuthError
    );
  });
});

describe("prepareRuntime", () => {
  test("env mode skips login and keeps the loaded token", async () => {
    const { config, mode } = await prepareRuntime([], {
      API_URL: "http://localhost:8787",
      BRIDGE_TOKEN: "dev-bridge-token",
    });
    expect(mode).toBe("env");
    expect(config.API_URL).toBe("http://localhost:8787");
    expect(config.BRIDGE_TOKEN).toBe("dev-bridge-token");
  });

  test("target mode pings, logs in, and swaps the token", async () => {
    const asked: string[] = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith("/health")) return Response.json({ ok: true, service: "fambot-api" });
      expect(href).toBe("https://fambot.fly.dev/api/bridge/login");
      expect(JSON.parse(String(init?.body))).toEqual({
        email: "nick@example.com",
        password: "secret",
      });
      return Response.json({ token: "prod-bridge-token", user: { name: "Nick", email: "nick@example.com" } });
    }) as typeof fetch;

    const { config, mode } = await prepareRuntime(["--target", "prod"], {}, {
      fetchFn,
      log: () => {},
      io: {
        ask: async (label) => {
          asked.push(label);
          if (/API URL/i.test(label)) return "";
          return "nick@example.com";
        },
        askHidden: async () => "secret",
      },
    });
    expect(mode).toBe("prod");
    expect(config.API_URL).toBe("https://fambot.fly.dev");
    expect(config.BRIDGE_TOKEN).toBe("prod-bridge-token");
    expect(asked.some((label) => /API URL/i.test(label))).toBe(true);
    expect(asked.some((label) => /email/i.test(label))).toBe(true);
  });
});
