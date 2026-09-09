import { eq } from "drizzle-orm";
import type { Db } from "@fambot/database";
import { conversations, messages, outboxMessages } from "@fambot/database";

/**
 * Messaging channels are adapters (design doc §7). The pipeline and worker
 * send through this interface and never know channel details.
 */
export interface MessagingChannel {
  sendMessage(args: { conversationId: string; text: string }): Promise<void>;
}

/**
 * App chat: an outbound row in `messages`; the client polls/refetches the
 * conversation.
 */
export class AppChatChannel implements MessagingChannel {
  constructor(private db: Db) {}

  async sendMessage({ conversationId, text }: { conversationId: string; text: string }): Promise<void> {
    await this.db.insert(messages).values({
      conversationId,
      direction: "outbound",
      channel: "app_chat",
      text,
      sentAt: new Date(),
    });
  }
}

/**
 * iMessage: enqueue into the outbox; the Mac bridge consumes over WebSocket,
 * sends via imsg, and acks with the resulting message GUID.
 */
export class ImsgChannel implements MessagingChannel {
  constructor(
    private db: Db,
    private notify?: () => void
  ) {}

  async sendMessage({ conversationId, text }: { conversationId: string; text: string }): Promise<void> {
    const [conv] = await this.db
      .select({ externalId: conversations.externalId })
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!conv?.externalId) throw new Error(`conversation ${conversationId} has no chat_guid`);
    await this.db.insert(outboxMessages).values({
      conversationId,
      chatGuid: conv.externalId,
      text,
    });
    // Also mirror bot output into the conversation history.
    await this.db.insert(messages).values({
      conversationId,
      direction: "outbound",
      channel: "imessage",
      text,
      sentAt: new Date(),
    });
    this.notify?.();
  }
}

/** Routes to the right channel based on the conversation's channel column. */
export class ChannelRouter implements MessagingChannel {
  constructor(
    private db: Db,
    private appChat: MessagingChannel,
    private imsg: MessagingChannel
  ) {}

  async sendMessage(args: { conversationId: string; text: string }): Promise<void> {
    const [conv] = await this.db
      .select({ channel: conversations.channel })
      .from(conversations)
      .where(eq(conversations.id, args.conversationId));
    if (!conv) throw new Error(`conversation ${args.conversationId} not found`);
    if (conv.channel === "imessage") return this.imsg.sendMessage(args);
    return this.appChat.sendMessage(args);
  }
}
