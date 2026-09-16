/**
 * Browser / webview origins allowed to talk to the API with credentials.
 * Shared by CORS and Better Auth so the allowlist cannot drift.
 *
 * Local iOS (Simulator or a phone hitting Vite on the LAN) keeps cookies
 * first-party via the Vite `/api` proxy. Private-LAN :5173 origins are
 * accepted only when APP_URL itself is a loopback address.
 */

export const STATIC_TRUSTED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:1420",
  "tauri://localhost",
  "https://tauri.localhost",
  "https://asset.localhost",
] as const;

const PRIVATE_LAN_VITE =
  /^https?:\/\/(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}):5173$/;

export function isLoopbackAppUrl(appUrl: string): boolean {
  try {
    const host = new URL(appUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  } catch {
    return false;
  }
}

export function isAllowedOrigin(origin: string, appUrl: string): boolean {
  if (!origin) return false;
  if (origin === appUrl) return true;
  if ((STATIC_TRUSTED_ORIGINS as readonly string[]).includes(origin)) return true;
  return isLoopbackAppUrl(appUrl) && PRIVATE_LAN_VITE.test(origin);
}

export function trustedOrigins(appUrl: string, requestOrigin?: string | null): string[] {
  const origins = new Set<string>([appUrl, ...STATIC_TRUSTED_ORIGINS]);
  if (requestOrigin && isAllowedOrigin(requestOrigin, appUrl)) {
    origins.add(requestOrigin);
  }
  return [...origins];
}
