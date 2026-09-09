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
 * Inbound message pipeline. Consumes `imsg rpc` watch notifications, applies
 * the per-profile filters, maintains the in-memory context buffer, and hands
 * invocations (tagged messages) to the agent runner.
 */
export function createInboundHandler(deps: {
  config: BridgeConfig;
  state: BridgeState;
  contextBuffer: ContextBuffer;
  matcher: InvocationMatcher;
  onInvocation: (invocation: Invocation) => void;
}): (message: ImsgMessage) => void {
  const { config, state, contextBuffer, matcher, onInvocation } = deps;

  return function handleMessage(msg: ImsgMessage): void {
    const chatGuid = msg.chat_guid;
    const messageGuid = msg.guid;
    const text = msg.text?.trim();
    // Attachment-only, reaction, and poll rows have no usable text — dropped.
    if (!chatGuid || !messageGuid || !text) return;

    // Self-message handling. Our own sends echo back through the watch stream.
    if (msg.is_from_me) {
      if (config.profile === "production") return; // plain is_from_me drop
      // local-dev: bot and developer share one identity. If this is
      // recognizably the bot's own output, buffer it as a bot turn — multi-turn
      // flows (onboarding Q&A) need the bot's questions in the context — but
      // never invoke on it.
      // Prefix check only when a prefix is configured — startsWith("") matches
      // everything and would swallow the developer's own messages.
      const isBotEcho =
        (config.botMessagePrefix !== "" && text.startsWith(config.botMessagePrefix)) ||
        state.wasSentByUs(messageGuid);
      if (isBotEcho) {
        contextBuffer.add(chatGuid, {
          messageGuid,
          senderHandle: "__fambot__",
          senderName: "FamBot",
          text:
            config.botMessagePrefix !== "" && text.startsWith(config.botMessagePrefix)
              ? text.slice(config.botMessagePrefix.length).trim()
              : text,
          sentAt: msg.created_at ?? new Date().toISOString(),
          invokedBot: false,
          isFromMe: true,
          isBot: true,
        });
        return;
      }
    }

    const sentAt = msg.created_at ?? new Date().toISOString();
    const senderHandle = msg.is_from_me ? "__me__" : normalizeHandle(msg.sender);
    const senderName = msg.sender_name?.trim() ? msg.sender_name : null;
    // Only an explicit @mention invokes the bot — untagged messages (even
    // direct replies to the bot's own question) are buffered as context only.
    const invoked = matcher.matches(text);

    contextBuffer.add(chatGuid, {
      messageGuid,
      senderHandle,
      senderName,
      text,
      sentAt,
      invokedBot: invoked,
      isFromMe: msg.is_from_me ?? false,
      isBot: false,
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
