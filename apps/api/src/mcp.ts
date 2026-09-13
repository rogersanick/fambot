import { Hono } from "hono";
import { StreamableHTTPTransport } from "@hono/mcp";
import { and, eq } from "drizzle-orm";
import { conversationParticipants, conversations, households, members } from "@fambot/database";
import { toLocalIso, type ExecutionContext } from "@fambot/domain";
import { createFambotMcpServer } from "@fambot/mcp";
import { GoogleCalendarProvider } from "@fambot/calendar";
import { ai, db, services } from "./context";
import { env, googleEnabled } from "./env";
import { verifyMcpToken, type McpClaims } from "./mcp-auth";

/**
 * Build the household-scoped ExecutionContext for one MCP request. Every
 * claim is re-resolved against the database — a deleted member or a token
 * whose member moved households stops working immediately.
 */
export async function buildMcpExecutionContext(claims: McpClaims): Promise<ExecutionContext | null> {
  const [actor] = await db.select().from(members).where(eq(members.id, claims.memberId));
  if (!actor || actor.householdId !== claims.householdId) return null;
  const [household] = await db
    .select()
    .from(households)
    .where(eq(households.id, claims.householdId));
  if (!household) return null;

  let conversation: ExecutionContext["conversation"] = null;
  let participants: ExecutionContext["participants"] = [];
  const householdMembers = await db
    .select({ id: members.id, displayName: members.displayName })
    .from(members)
    .where(eq(members.householdId, household.id));

  if (claims.conversationId) {
    const [row] = await db
      .select()
      .from(conversations)
      .where(
        and(eq(conversations.id, claims.conversationId), eq(conversations.householdId, household.id))
      );
    if (!row) return null; // conversation claim must belong to the household
    conversation = {
      id: row.id,
      kind: row.kind as "direct" | "group",
      channel: row.channel as "imessage" | "app_chat" | "sms",
    };
    const participantRows = await db
      .select({ memberId: conversationParticipants.memberId })
      .from(conversationParticipants)
      .where(eq(conversationParticipants.conversationId, row.id));
    const ids = new Set(participantRows.map((p) => p.memberId));
    participants = householdMembers.filter((m) => ids.has(m.id));
  }

  const externalCalendar =
    googleEnabled && actor.userId
      ? await GoogleCalendarProvider.forUser(
          db,
          {
            clientId: env.GOOGLE_CLIENT_ID!,
            clientSecret: env.GOOGLE_CLIENT_SECRET!,
            redirectUri: `${env.API_BASE_URL}/api/integrations/google/callback`,
            encryptionKey: env.TOKEN_ENCRYPTION_KEY,
          },
          actor.userId
        )
      : null;

  return {
    db,
    services,
    externalCalendar,
    // Second constrained AI pass for get_comment_status (bodies are untrusted).
    summarizeStatus: ({ subjectType, title, comments }) =>
      ai.summarizeStatus({
        subjectType,
        title,
        timezone: household.timezone,
        nowLocal: toLocalIso(new Date(), household.timezone),
        comments: comments.map((c) => ({
          authorName: c.authorName,
          body: c.body,
          createdAtLocal: toLocalIso(c.createdAt, household.timezone),
        })),
      }),
    householdId: household.id,
    timezone: household.timezone,
    actor: {
      memberId: actor.id,
      householdId: household.id,
      role: actor.role as "owner" | "member",
      displayName: actor.displayName,
    },
    conversation,
    participants,
    householdMembers,
  };
}

/**
 * Stateless Streamable HTTP MCP endpoint. Each POST carries a short-lived
 * delegated bearer token; a fresh server instance is created per request so
 * no session state ever crosses households.
 */
export const mcpApp = new Hono();

mcpApp.all("/mcp", async (c) => {
  const header = c.req.header("authorization");
  if (!header?.startsWith("Bearer ")) {
    return c.json({ error: "missing_bearer_token" }, 401);
  }
  const claims = await verifyMcpToken(header.slice("Bearer ".length));
  if (!claims) return c.json({ error: "invalid_token" }, 401);

  const ctx = await buildMcpExecutionContext(claims);
  if (!ctx) return c.json({ error: "unknown_principal" }, 403);

  const server = createFambotMcpServer(ctx);
  const transport = new StreamableHTTPTransport();
  await server.connect(transport);
  return transport.handleRequest(c);
});
