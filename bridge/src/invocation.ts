/**
 * Invocation tag matching. `@fambot` / `fambot` always work; each channel may
 * additionally answer to a custom name synced from the server via heartbeat
 * (`chat_guid → invocation_name`). Matching is case-insensitive and
 * word-bounded, with or without the leading `@`.
 */
export class InvocationMatcher {
  private map = new Map<string, string>();

  updateMap(entries: Record<string, string>): void {
    this.map = new Map(
      Object.entries(entries).map(([guid, name]) => [guid, name.toLowerCase()]),
    );
  }

  namesFor(chatGuid: string): string[] {
    const custom = this.map.get(chatGuid);
    return custom && custom !== "fambot" ? ["fambot", custom] : ["fambot"];
  }

  matches(chatGuid: string, text: string): boolean {
    for (const name of this.namesFor(chatGuid)) {
      const re = new RegExp(`(^|[^a-z0-9])@?${escapeRegExp(name)}($|[^a-z0-9])`, "i");
      if (re.test(text)) return true;
    }
    return false;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
