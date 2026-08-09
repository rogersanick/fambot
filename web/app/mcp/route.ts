import { createClient } from "@supabase/supabase-js";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { registerFambotTools } from "@/lib/mcp/tools";

const handler = createMcpHandler(registerFambotTools, {
  serverInfo: { name: "fambot", version: "2.0.0" },
});

/**
 * Bearer tokens are Supabase-issued JWTs (the agent signs in as a Supabase
 * user). Verification asks Supabase auth; the token is then carried into tool
 * handlers where an RLS-bound client is built from it.
 */
const verifyToken = async (_req: Request, bearerToken?: string) => {
  if (!bearerToken) return undefined;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase.auth.getUser(bearerToken);
  if (error || !data.user) return undefined;
  return {
    token: bearerToken,
    clientId: data.user.id,
    scopes: [],
    extra: { email: data.user.email },
  };
};

const authHandler = withMcpAuth(handler, verifyToken, { required: true });

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
