import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { account, session, user, verification } from "@fambot/database";
import { db } from "./context";
import { env, googleEnabled } from "./env";
import { trustedOrigins } from "./origins";

/**
 * Better Auth: Google OAuth is the primary sign-in when configured;
 * email/password stays enabled as the local-dev fallback. The magic-link
 * plugin can be added later without structural change.
 */
export const auth = betterAuth({
  baseURL: env.API_BASE_URL,
  basePath: "/api/auth",
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
  },
  ...(googleEnabled
    ? {
        socialProviders: {
          google: {
            clientId: env.GOOGLE_CLIENT_ID!,
            clientSecret: env.GOOGLE_CLIENT_SECRET!,
          },
        },
      }
    : {}),
  trustedOrigins: (request) => trustedOrigins(env.APP_URL, request?.headers.get("origin")),
});

export type AuthUser = typeof auth.$Infer.Session.user;
