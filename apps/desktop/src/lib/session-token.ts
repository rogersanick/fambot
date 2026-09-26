/**
 * Bearer-session storage for bundled Tauri builds, kept free of better-auth
 * imports so `lib/api.ts` (and its unit-tested dependents) can import it
 * without dragging the auth client into non-browser test environments.
 *
 * Bundled Tauri builds (custom-scheme webview) can't rely on cross-site
 * cookies against the Fly API, so they persist the Better Auth bearer token
 * here; web and dev-proxy builds keep plain cookies and all of this stays
 * inert (`useBearerAuth` is false).
 */
const hasWindow = typeof window !== "undefined";

export const useBearerAuth =
  hasWindow &&
  "__TAURI_INTERNALS__" in window &&
  Boolean(import.meta.env.VITE_API_URL) &&
  import.meta.env.VITE_API_URL !== window.location.origin;

const TOKEN_KEY = "fambot-session-token";

export function sessionToken(): string | null {
  return useBearerAuth ? localStorage.getItem(TOKEN_KEY) : null;
}

export function storeSessionToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearSessionToken(): void {
  if (hasWindow) localStorage.removeItem(TOKEN_KEY);
}
