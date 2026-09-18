import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");

export function flyAppName(): string {
  const text = readFileSync(resolve(root, "fly.toml"), "utf8");
  const match = text.match(/^app\s*=\s*"([^"]+)"/m);
  if (!match) throw new Error('fly.toml is missing app = "..."');
  return match[1]!;
}

export function prodApiUrl(app = flyAppName()): string {
  return `https://${app}.fly.dev`;
}
