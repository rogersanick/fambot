import { createAuthClient } from "better-auth/react";
import { clearSessionToken, storeSessionToken, useBearerAuth } from "./session-token";

/**
 * In dev the Vite proxy makes /api first-party; the deployed web build sets
 * VITE_API_URL to the Fly API and Better Auth uses cross-origin cookies.
 *
 * Bundled Tauri builds use the Better Auth bearer plugin instead: the opaque
 * session token from the `set-auth-token` response header is persisted (see
 * lib/session-token.ts) and attached as `Authorization: Bearer` everywhere.
 */
const base = import.meta.env.VITE_API_URL || window.location.origin;

export const authClient = createAuthClient({
  baseURL: `${base}/api/auth`,
  ...(useBearerAuth
    ? {
        fetchOptions: {
          auth: {
            type: "Bearer" as const,
            token: () => localStorage.getItem("fambot-session-token") ?? "",
          },
          onSuccess: (ctx: { response: Response }) => {
            const token = ctx.response.headers.get("set-auth-token");
            if (token) storeSessionToken(token);
          },
        },
      }
    : {}),
});

export const { useSession, signIn, signUp } = authClient;

/** Sign out and drop the stored bearer token (harmless when cookie-based). */
export async function signOut() {
  try {
    return await authClient.signOut();
  } finally {
    clearSessionToken();
  }
}
