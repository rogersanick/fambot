import { createAuthClient } from "better-auth/react";

/**
 * In dev the Vite proxy makes /api first-party; the deployed web build sets
 * VITE_API_URL to the Fly API and Better Auth uses cross-origin cookies.
 */
const base = import.meta.env.VITE_API_URL || window.location.origin;

export const authClient = createAuthClient({
  baseURL: `${base}/api/auth`,
});

export const { useSession, signIn, signUp, signOut } = authClient;
