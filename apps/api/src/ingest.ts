import { Hono } from "hono";
import { z } from "zod";
import type { InboundMessage } from "@fambot/shared";
import { env } from "./env";
import { processInbound } from "./pipeline";

/**
 * Bridge inbound webhook (replaces the design doc's BlueBubbles webhook —
 * our transport is the imsg CLI relay). Auth: static bridge token, issued to
 * household owners via POST /api/bridge/login.
 */

const IngestSchema = z.object({
  guid: z.string().min(1),
  chatGuid: z.string().min(1),
  text: z.string(),
  senderHandle: z.string().min(1),
  senderName: z.string().optional(),
  senderMemberId: z.string().uuid().optional(),
  isGroup: z.boolean().default(false),
  sentAt: z.string().datetime({ offset: true }).optional(),
});

export const ingest = new Hono();

ingest.post("/api/ingest/imessage", async (c) => {
  const authz = c.req.header("authorization");
  if (authz !== `Bearer ${env.BRIDGE_TOKEN}`) return c.json({ error: "unauthorized" }, 401);

  const body = IngestSchema.parse(await c.req.json());
  if (!body.text.trim()) return c.json({ ok: true, skipped: "empty" });

  const inbound: InboundMessage = {
    id: `imessage:${body.guid}`,
    channel: "imessage",
    externalMessageId: body.guid,
    conversationExternalId: body.chatGuid,
    sender: {
      externalId: body.senderHandle,
      displayName: body.senderName,
      memberId: body.senderMemberId,
    },
    text: body.text,
    sentAt: body.sentAt ?? new Date().toISOString(),
    context: {
      isGroup: body.isGroup,
      botWasMentioned: false, // recomputed in the pipeline with the household bot name
      isReplyToBot: false,
    },
  };

  const result = await processInbound(inbound);
  return c.json({
    ok: true,
    routed: result !== null,
    invoked: result?.invoked ?? false,
  });
});
