import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";

/**
 * Delegated MCP credentials. The pipeline mints one per agent run; the /mcp
 * endpoint verifies the signature and then RE-RESOLVES every claim against
 * the database, so a token is a capability to *ask*, never a source of truth.
 *
 * The scheme is deliberately pluggable: external agents can later get their
 * own issuer (OAuth / personal access tokens) producing the same claims.
 */
export type McpClaims = {
  memberId: string;
  householdId: string;
  conversationId: string | null;
  /** Who is acting: the built-in agent today; external integrations later. */
  source: "agent" | "external";
  /** Correlates all tool calls of one run in logs/audit. */
  requestId: string;
};

const ISSUER = "fambot-api";
const AUDIENCE = "fambot-mcp";

function signingKey(): Uint8Array {
  return new TextEncoder().encode(env.MCP_SIGNING_SECRET);
}

export async function mintMcpToken(claims: McpClaims, ttlSeconds = 300): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(signingKey());
}

export async function verifyMcpToken(token: string): Promise<McpClaims | null> {
  try {
    const { payload } = await jwtVerify(token, signingKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (
      typeof payload.memberId !== "string" ||
      typeof payload.householdId !== "string" ||
      typeof payload.requestId !== "string" ||
      (payload.source !== "agent" && payload.source !== "external")
    ) {
      return null;
    }
    return {
      memberId: payload.memberId,
      householdId: payload.householdId,
      conversationId: typeof payload.conversationId === "string" ? payload.conversationId : null,
      source: payload.source,
      requestId: payload.requestId,
    };
  } catch {
    return null;
  }
}
