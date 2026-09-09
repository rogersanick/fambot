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
 * DMs and app chat always invoke; groups require a mention or a reply to the bot.
 */
export function shouldInvokeAssistant(message: InboundMessage): boolean {
  if (!message.context.isGroup) return true;
  if (message.context.botWasMentioned) return true;
  if (message.context.isReplyToBot) return true;
  return false;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
