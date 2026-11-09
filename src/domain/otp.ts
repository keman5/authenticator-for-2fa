import { InputError, normalizeSecret, type Credential } from "./records";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function decodeBase32(secret: string): Uint8Array {
  const text = normalizeSecret(secret);
  const out: number[] = [];
  let bits = 0,
    buffer = 0;
  for (const char of text) {
    buffer = (buffer << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >>> bits) & 255);
    }
  }
  // OTP providers sometimes leave nonzero padding bits; only complete bytes are key material.
  if (!out.length) throw new InputError("invalid");
  return new Uint8Array(out);
}
export function encodeBase32(bytes: Uint8Array): string {
  let buffer = 0,
    bits = 0,
    result = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(buffer >>> bits) & 31];
    }
  }
  if (bits) result += alphabet[(buffer << (5 - bits)) & 31];
  return result;
}
export async function codeFor(
  item: Credential,
  time = Date.now(),
): Promise<string> {
  if (!Number.isFinite(time) || time < 0) throw new InputError("invalid");
  const moving =
    item.mode === "hotp"
      ? item.counter
      : Math.floor(time / 1000 / item.interval);
  const message = new ArrayBuffer(8);
  new DataView(message).setBigUint64(0, BigInt(moving));
  const key = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(decodeBase32(item.secret)),
    { name: "HMAC", hash: item.mode === "steam" ? "SHA-1" : item.hash },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = digest[digest.length - 1]! & 15;
  let value =
    (digest[offset]! & 127) * 0x1000000 +
    (digest[offset + 1]! << 16) +
    (digest[offset + 2]! << 8) +
    digest[offset + 3]!;
  if (item.mode === "steam") {
    const chars = "23456789BCDFGHJKMNPQRTVWXY";
    let result = "";
    for (let i = 0; i < 5; i++) {
      result += chars[value % chars.length];
      value = Math.floor(value / chars.length);
    }
    return result;
  }
  return String(value % 10 ** item.digits).padStart(item.digits, "0");
}
