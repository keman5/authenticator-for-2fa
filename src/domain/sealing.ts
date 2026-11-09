import { InputError, type Gate } from "./records";
const encoder = new TextEncoder();
export const ROUNDS = 310_000;
export function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (const value of bytes) text += String.fromCharCode(value);
  return btoa(text);
}
export function fromBase64(value: string, limit = 4_000_000): Uint8Array {
  if (typeof value !== "string" || value.length > limit)
    throw new InputError("invalid");
  try {
    return Uint8Array.from(
      atob(value.replace(/-/g, "+").replace(/_/g, "/")),
      (c) => c.charCodeAt(0),
    );
  } catch {
    throw new InputError("invalid");
  }
}
async function passwordMaterial(password: string): Promise<CryptoKey> {
  if (!password.length) throw new InputError("emptyPassword");
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"],
  );
}
async function passwordKey(
  password: string,
  salt: Uint8Array,
  rounds = ROUNDS,
): Promise<CryptoKey> {
  if (
    !Number.isInteger(rounds) ||
    rounds < 100_000 ||
    rounds > 1_000_000 ||
    salt.length !== 16
  )
    throw new InputError("invalid");
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt),
      iterations: rounds,
      hash: "SHA-256",
    },
    await passwordMaterial(password),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
export async function newGate(password: string): Promise<Gate> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const proof = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: ROUNDS, hash: "SHA-256" },
    await passwordMaterial(password),
    256,
  );
  return {
    salt: toBase64(salt),
    proof: toBase64(new Uint8Array(proof)),
  };
}
export async function checkGate(
  gate: Gate,
  password: string,
): Promise<boolean> {
  if (!password) return false;
  try {
    const salt = fromBase64(gate.salt);
    if (salt.length !== 16) return false;
    const proof = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: new Uint8Array(salt),
        iterations: ROUNDS,
        hash: "SHA-256",
      },
      await passwordMaterial(password),
      256,
    );
    const expected = fromBase64(gate.proof);
    const actual = new Uint8Array(proof);
    if (actual.length !== expected.length) return false;
    let difference = 0;
    for (let i = 0; i < actual.length; i++)
      difference |= actual[i]! ^ expected[i]!;
    return difference === 0;
  } catch {
    return false;
  }
}
export interface Sealed {
  iv: string;
  payload: string;
}
export async function rawKey(encoded: string): Promise<CryptoKey> {
  const bytes = fromBase64(encoded, 64);
  if (bytes.length !== 32) throw new InputError("invalid");
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(bytes),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
export async function seal(
  data: unknown,
  key: CryptoKey,
  context = "",
): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    key,
    encoder.encode(JSON.stringify(data)),
  );
  return { iv: toBase64(iv), payload: toBase64(new Uint8Array(payload)) };
}
export async function unseal(
  box: Sealed,
  key: CryptoKey,
  context = "",
): Promise<unknown> {
  const iv = fromBase64(box.iv, 64);
  if (iv.length !== 12) throw new InputError("invalid");
  const decoded = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: new Uint8Array(iv),
      additionalData: encoder.encode(context),
    },
    key,
    new Uint8Array(fromBase64(box.payload)),
  );
  return JSON.parse(new TextDecoder().decode(decoded)) as unknown;
}
export async function encryptedBackup(
  data: unknown,
  password: string,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return JSON.stringify(
    {
      format: "authenticator.portable",
      version: 2,
      rounds: ROUNDS,
      salt: toBase64(salt),
      ...(await seal(data, await passwordKey(password, salt))),
    },
    null,
    2,
  );
}
export function isProtectedBackup(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const x = value as Record<string, unknown>;
  return (
    x.format === "authenticator.portable" ||
    Boolean(x.vault) ||
    Boolean(x.envelope) ||
    Boolean(x.kdf && x.cipher)
  );
}
export async function openBackup(
  value: unknown,
  password: string,
): Promise<unknown> {
  if (!value || typeof value !== "object") throw new InputError("invalid");
  const x = value as Record<string, unknown>;
  if (x.format === "authenticator.portable") {
    if (
      x.version !== 2 ||
      typeof x.salt !== "string" ||
      typeof x.iv !== "string" ||
      typeof x.payload !== "string" ||
      typeof x.rounds !== "number"
    )
      throw new InputError("invalid");
    const key = await passwordKey(password, fromBase64(x.salt, 64), x.rounds);
    try {
      return await unseal({ iv: x.iv, payload: x.payload }, key);
    } catch {
      throw new InputError("password");
    }
  }
  const old = (x.vault ?? x.envelope ?? x) as Record<string, unknown>;
  const kdf = old.kdf as Record<string, unknown> | undefined;
  const cipher = old.cipher as Record<string, unknown> | undefined;
  if (
    old.version !== 1 ||
    kdf?.name !== "PBKDF2" ||
    kdf.hash !== "SHA-256" ||
    cipher?.name !== "AES-GCM" ||
    typeof kdf.salt !== "string" ||
    typeof kdf.iterations !== "number" ||
    typeof cipher.iv !== "string" ||
    typeof cipher.data !== "string"
  )
    throw new InputError("invalid");
  const key = await passwordKey(
    password,
    fromBase64(kdf.salt, 64),
    kdf.iterations,
  );
  try {
    return await unseal({ iv: cipher.iv, payload: cipher.data }, key);
  } catch {
    throw new InputError("password");
  }
}
