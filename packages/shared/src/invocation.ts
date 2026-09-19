import type { InboundMessage } from "./inbound-message";

/**
 * Invocation tag matching: an explicit `@fambot` (or `@` + a configured
 * alias), case-insensitive, word-bounded. The bare name without `@` never
 * invokes — the bot only responds in groups when deliberately tagged.
 * (Ported from bridge/src/invocation.ts.)
 */
export class InvocationMatcher {
  private readonly names: string[];

  constructor(botName = "fambot") {
    const custom = botName.toLowerCase();
    this.names = custom === "fambot" ? ["fambot", "fam"] : ["fambot", "fam", custom];
  }

  matches(text: string): boolean {
    for (const name of this.names) {
      const re = new RegExp(`(^|[^a-z0-9])@${escapeRegExp(name)}($|[^a-z0-9])`, "i");
      if (re.test(text)) return true;
    }
    return false;
  }

  /** Strip the mention tag so the model sees a clean request. */
  strip(text: string): string {
    let out = text;
    for (const name of this.names) {
      out = out.replace(new RegExp(`@${escapeRegExp(name)}[,:]?\\s*`, "gi"), "");
    }
    return out.trim();
  }
}

/**
 * Deterministic trigger detection (design doc §9). Never LLM-based.
 *
 * iMessage always requires an explicit @tag (or a reply to the bot), even in
 * DMs: the Mac bridge relays the owner's entire personal Messages stream, so
 * a direct text to the owner is not inherently addressed to Fambot.
 *
 * SMS and app chat DMs always invoke — texting the Fambot number or typing in
 * the app's chat tab is unambiguously talking to the bot. Groups on every
 * channel require a mention or a reply to the bot.
 */
export function shouldInvokeAssistant(message: InboundMessage): boolean {
  if (message.context.botWasMentioned) return true;
  if (message.context.isReplyToBot) return true;
  if (message.channel === "imessage") return false;
  return !message.context.isGroup;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
