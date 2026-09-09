/**
 * Normalized message model. Every input channel (imessage, app chat, future
 * SMS) is converted into this shape before anything downstream sees it.
 * Nothing below the messaging adapters may depend on channel-specific
 * payloads.
 */
export type Channel = "imessage" | "app_chat";

export type InboundMessage = {
  /** Stable id for idempotency: `${channel}:${externalMessageId}` or a uuid for app chat. */
  id: string;
  channel: Channel;
  /** Channel-native message id (imsg GUID). Used for dedup. */
  externalMessageId?: string;
  /** Channel-native conversation id (imsg chat_guid) or internal conversation uuid for app chat. */
  conversationExternalId: string;
  sender: {
    /** Channel-native sender identity (imsg handle, or member id for app chat). */
    externalId: string;
    displayName?: string;
  };
  text: string;
  sentAt: string; // ISO timestamp
  context: {
    isGroup: boolean;
    botWasMentioned: boolean;
    isReplyToBot: boolean;
  };
};

export type ConversationTurn = {
  sender: string; // display name, or "Fambot"
  isBot: boolean;
  text: string;
  at: string; // ISO
};
