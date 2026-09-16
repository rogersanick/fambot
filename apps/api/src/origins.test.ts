import { describe, expect, test } from "bun:test";
import { isAllowedOrigin, isLoopbackAppUrl, trustedOrigins } from "./origins";

describe("isLoopbackAppUrl", () => {
  test("accepts localhost and loopback IPs", () => {
    expect(isLoopbackAppUrl("http://localhost:5173")).toBe(true);
    expect(isLoopbackAppUrl("http://127.0.0.1:5173")).toBe(true);
    expect(isLoopbackAppUrl("http://[::1]:5173")).toBe(true);
  });

  test("rejects public hosts", () => {
    expect(isLoopbackAppUrl("https://app.fambot.app")).toBe(false);
  });
});

describe("isAllowedOrigin", () => {
  const localApp = "http://localhost:5173";

  test("allows the configured app URL and static Tauri / Vite origins", () => {
    expect(isAllowedOrigin(localApp, localApp)).toBe(true);
    expect(isAllowedOrigin("tauri://localhost", localApp)).toBe(true);
    expect(isAllowedOrigin("https://tauri.localhost", localApp)).toBe(true);
    expect(isAllowedOrigin("https://asset.localhost", localApp)).toBe(true);
    expect(isAllowedOrigin("http://localhost:1420", localApp)).toBe(true);
  });

  test("allows private-LAN Vite origins only while APP_URL is loopback", () => {
    expect(isAllowedOrigin("http://192.168.1.20:5173", localApp)).toBe(true);
    expect(isAllowedOrigin("http://10.0.0.8:5173", localApp)).toBe(true);
    expect(isAllowedOrigin("http://172.16.4.2:5173", localApp)).toBe(true);
    expect(isAllowedOrigin("http://192.168.1.20:5173", "https://app.fambot.app")).toBe(false);
  });

  test("rejects public or wrong-port origins", () => {
    expect(isAllowedOrigin("https://evil.example", localApp)).toBe(false);
    expect(isAllowedOrigin("http://192.168.1.20:3000", localApp)).toBe(false);
    expect(isAllowedOrigin("http://8.8.8.8:5173", localApp)).toBe(false);
    expect(isAllowedOrigin("", localApp)).toBe(false);
  });
});

describe("trustedOrigins", () => {
  test("always includes the app URL and static list", () => {
    const list = trustedOrigins("http://localhost:5173");
    expect(list).toContain("http://localhost:5173");
    expect(list).toContain("tauri://localhost");
    expect(list).toContain("https://tauri.localhost");
  });

  test("adds an allowed request origin", () => {
    const list = trustedOrigins("http://localhost:5173", "http://192.168.0.12:5173");
    expect(list).toContain("http://192.168.0.12:5173");
  });
});
