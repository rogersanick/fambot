import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export type EnvMap = Record<string, string>;

export function parseEnv(text: string): EnvMap {
  const result: EnvMap = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 1) continue;
    const key = line.slice(0, equals).trim();
    let value = line.slice(equals + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

export async function readEnvFile(path: string): Promise<EnvMap> {
  if (!existsSync(path)) return {};
  return parseEnv(await Bun.file(path).text());
}

function encodeEnvValue(value: string): string {
  if (value === "") return "";
  if (/[\s#"'$`\\]/.test(value)) return JSON.stringify(value);
  return value;
}

export function formatEnvFile(header: string, entries: Array<[string, string | undefined]>): string {
  const lines = header.trimEnd() ? [header.trimEnd(), ""] : [];
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    lines.push(`${key}=${encodeEnvValue(value)}`);
  }
  return `${lines.join("\n")}\n`;
}

export function writeEnvFile(path: string, header: string, entries: Array<[string, string | undefined]>) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatEnvFile(header, entries), { mode: 0o600 });
}

export function isPlaceholder(value: string | undefined, placeholders: string[]): boolean {
  if (!value) return true;
  return placeholders.includes(value);
}

export function keepOrGenerate(
  current: string | undefined,
  placeholders: string[],
  generate: () => string,
): string {
  if (isPlaceholder(current, placeholders)) return generate();
  return current!;
}
