/**
 * Invocation tag matching: an explicit `@fambot` (or `@` + the configured
 * BOT_NAME), case-insensitive, word-bounded. The bare name without `@` never
 * invokes — the bot only responds when deliberately tagged.
 */
export class InvocationMatcher {
  private readonly names: string[];

  constructor(botName = "fambot") {
    const custom = botName.toLowerCase();
    this.names = custom === "fambot" ? ["fambot"] : ["fambot", custom];
  }

  matches(text: string): boolean {
    for (const name of this.names) {
      const re = new RegExp(`(^|[^a-z0-9])@${escapeRegExp(name)}($|[^a-z0-9])`, "i");
      if (re.test(text)) return true;
    }
    return false;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
