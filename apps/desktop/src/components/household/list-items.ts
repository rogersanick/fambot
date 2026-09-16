export const MAX_NEW_LIST_ITEMS = 50;

/** One checklist entry per line; strips common bullets/numbering from pasted notes. */
export function splitListItems(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
}
