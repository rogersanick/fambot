/**
 * AES-256-GCM token encryption at rest. Key = 32-byte hex/base64 secret
 * (TOKEN_ENCRYPTION_KEY). Format: base64(iv).base64(ciphertext+tag).
 */

async function importKey(secret: string): Promise<CryptoKey> {
  const raw = new TextEncoder().encode(secret.padEnd(32, "0").slice(0, 32));
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptToken(plain: string, secret: string): Promise<string> {
  const key = await importKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return `${Buffer.from(iv).toString("base64")}.${Buffer.from(ct).toString("base64")}`;
}

export async function decryptToken(enc: string, secret: string): Promise<string> {
  const [ivB64, ctB64] = enc.split(".");
  if (!ivB64 || !ctB64) throw new Error("bad token format");
  const key = await importKey(secret);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(ivB64, "base64") },
    key,
    Buffer.from(ctB64, "base64")
  );
  return new TextDecoder().decode(plain);
}
