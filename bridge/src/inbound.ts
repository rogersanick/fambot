import type { BridgeConfig } from "./config.js";
import type { Spool } from "./spool.js";
import type { ContextBuffer } from "./context-buffer.js";
import type { InvocationMatcher } from "./invocation.js";
import type { ImsgMessage, ImsgRpc } from "./imsg-rpc.js";
import type { IngestPayload } from "./fambot-api.js";

export function normalizeHandle(address: string | null | undefined): string {
  if (!address) return "__me__"; // self-sent messages may carry no handle
  return address.trim().toLowerCase();
}

/**
 * Inbound message pipeline. Consumes `imsg rpc` watch notifications, applies
 * the per-profile filters, maintains the in-memory context buffer, and spools
 * invocation payloads for forwarding. Transport-independent logic carried
 * over unchanged from the BlueBubbles webhook listener.
 */
export function createInboundHandler(deps: {
  config: BridgeConfig;
  spool: Spool;
  contextBuffer: ContextBuffer;
  matcher: InvocationMatcher;
  rpc: ImsgRpc;
  onInvocationSpooled: () => void;
}): (message: ImsgMessage) => void {
  const { config, spool, contextBuffer, matcher, rpc, onInvocationSpooled } = deps;

  return function handleMessage(msg: ImsgMessage): void {
    const chatGuid = msg.chat_guid;
    const messageGuid = msg.guid;
    const text = msg.text?.trim();
    // Attachment-only, reaction, and poll rows have no usable text — dropped.
    if (!chatGuid || !messageGuid || !text) return;

    // Local-dev: hard allowlist — everything else is ignored entirely, never buffered.
    if (config.profile === "local-dev" && !config.chatAllowlist.has(chatGuid)) return;

    // Self-message handling. Our own sends echo back through the watch stream.
    if (msg.is_from_me) {
      if (config.profile === "production") return; // plain is_from_me drop
      // local-dev: bot and developer share one identity. Drop only if it is
      // recognizably the bot's own output; otherwise it's the developer typing.
      if (text.startsWith(config.botMessagePrefix)) return;
      if (spool.wasSentByUs(messageGuid)) return;
    }

    const sentAt = msg.created_at ?? new Date().toISOString();
    const senderHandle = msg.is_from_me ? "__me__" : normalizeHandle(msg.sender);
    const senderName = msg.sender_name?.trim() ? msg.sender_name : null;
    const invoked = matcher.matches(chatGuid, text);

    contextBuffer.add(chatGuid, {
      messageGuid,
      senderHandle,
      senderName,
      text,
      sentAt,
      invokedBot: invoked,
      isFromMe: msg.is_from_me ?? false,
    });

    if (!invoked) return; // untagged messages never leave the Mac

    void spoolInvocation(chatGuid, messageGuid, senderHandle, senderName, text, sentAt, msg.is_from_me ?? false);
  };

  async function spoolInvocation(
    chatGuid: string,
    messageGuid: string,
    senderHandle: string,
    senderName: string | null,
    text: string,
    sentAt: string,
    isFromMe: boolean,
  ): Promise<void> {
    // Participants ride along so the server can seed/refresh the member
    // roster without calling back into the Mac.
    let participants: { address: string; displayName: string | null }[] | undefined;
    try {
      const chats = await rpc.chatsList(200);
      const chat = chats.find((c) => c.guid === chatGuid);
      participants = chat?.participants?.map((handle) => ({
        address: normalizeHandle(handle),
        displayName: null,
      }));
    } catch {
      participants = undefined;
    }

    const payload: IngestPayload = {
      message_guid: messageGuid,
      chat_guid: chatGuid,
      sender_handle: senderHandle,
      sender_name: senderName,
      message_text: text,
      sent_at: sentAt,
      is_from_me: isFromMe,
      context_turns: contextBuffer.select(chatGuid),
      chat_participants: participants,
    };

    spool.enqueue(payload);
    onInvocationSpooled();
  }
}
