import type { BridgeConfig } from "./config.js";
import type { BridgeState } from "./state.js";
import type { ContextBuffer, ContextTurn } from "./context-buffer.js";
import type { InvocationMatcher } from "./invocation.js";
import type { ImsgMessage } from "./imsg-rpc.js";

export function normalizeHandle(address: string | null | undefined): string {
  if (!address) return "__me__"; // self-sent messages may carry no handle
  return address.trim().toLowerCase();
}

export interface Invocation {
  chatGuid: string;
  messageGuid: string;
  senderHandle: string;
  senderName: string | null;
  text: string;
  sentAt: string;
  contextTurns: ContextTurn[];
}

/**
 * Lets a conversation continue without re-tagging the bot: after the bot
 * replies to someone in a chat, that person's next message there (within the
 * TTL) is treated as directed at the bot. One follow-up per bot reply — each
 * reply re-opens the window — so multi-turn flows like household onboarding
 * ("what should I call your household?" → "The Rogers") read naturally while
 * the bot stays out of unrelated group chatter.
 */
export class FollowUpWindow {
  private windows = new Map<string, { handle: string; expiresAt: number }>();

  constructor(private ttlMs = 3 * 60_000) {}

  /** Called after the bot replies to `senderHandle` in `chatGuid`. */
  open(chatGuid: string, senderHandle: string, now = Date.now()): void {
    this.windows.set(chatGuid, { handle: senderHandle, expiresAt: now + this.ttlMs });
  }

  /** True (and closes the window) if this message continues the conversation. */
  consume(chatGuid: string, senderHandle: string, now = Date.now()): boolean {
    const window = this.windows.get(chatGuid);
    if (!window) return false;
    if (now > window.expiresAt) {
      this.windows.delete(chatGuid);
      return false;
    }
    if (window.handle !== senderHandle) return false;
    this.windows.delete(chatGuid);
    return true;
  }
}

/**
 * Inbound message pipeline. Consumes `imsg rpc` watch notifications, applies
 * the per-profile filters, maintains the in-memory context buffer, and hands
 * invocations (tagged messages) to the agent runner.
 */
export function createInboundHandler(deps: {
  config: BridgeConfig;
  state: BridgeState;
  contextBuffer: ContextBuffer;
  matcher: InvocationMatcher;
  followUps: FollowUpWindow;
  onInvocation: (invocation: Invocation) => void;
}): (message: ImsgMessage) => void {
  const { config, state, contextBuffer, matcher, followUps, onInvocation } = deps;

  return function handleMessage(msg: ImsgMessage): void {
    const chatGuid = msg.chat_guid;
    const messageGuid = msg.guid;
    const text = msg.text?.trim();
    // Attachment-only, reaction, and poll rows have no usable text — dropped.
    if (!chatGuid || !messageGuid || !text) return;

    // Self-message handling. Our own sends echo back through the watch stream.
    if (msg.is_from_me) {
      if (config.profile === "production") return; // plain is_from_me drop
      // local-dev: bot and developer share one identity. Drop only if it is
      // recognizably the bot's own output; otherwise it's the developer typing.
      if (text.startsWith(config.botMessagePrefix)) return;
      if (state.wasSentByUs(messageGuid)) return;
    }

    const sentAt = msg.created_at ?? new Date().toISOString();
    const senderHandle = msg.is_from_me ? "__me__" : normalizeHandle(msg.sender);
    const senderName = msg.sender_name?.trim() ? msg.sender_name : null;
    // A mention anywhere invokes the bot; otherwise an open follow-up window
    // (bot just replied to this sender in this chat) continues the conversation.
    const invoked = matcher.matches(text) || followUps.consume(chatGuid, senderHandle);

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

    onInvocation({
      chatGuid,
      messageGuid,
      senderHandle,
      senderName,
      text,
      sentAt,
      contextTurns: contextBuffer.select(chatGuid),
    });
  };
}
