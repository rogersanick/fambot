/**
 * Normalized message model. Every input channel (imessage, app chat, sms) is
 * converted into this shape before anything downstream sees it. Nothing below
 * the messaging adapters may depend on channel-specific payloads.
 */
export type Channel = "imessage" | "app_chat" | "sms";

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
    /** Authenticated member override for messages authored by the bridge owner. */
    memberId?: string;
  };
  /** E.164 participants supplied by a native group-message webhook. */
  participantExternalIds?: string[];
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
