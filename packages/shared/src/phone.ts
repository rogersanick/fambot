/** Normalize US national numbers and international numbers to E.164. */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (!trimmed.startsWith("+")) {
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
    return null;
  }

  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return null;
  return `+${digits}`;
}

/** Friendly display format for North American numbers; E.164 for all others. */
export function formatPhone(input: string): string {
  const normalized = normalizePhone(input);
  if (!normalized) return input;
  if (/^\+1\d{10}$/.test(normalized)) {
    return `+1 (${normalized.slice(2, 5)}) ${normalized.slice(5, 8)}-${normalized.slice(8)}`;
  }
  return normalized;
}
