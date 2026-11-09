import {
  identify,
  InputError,
  validateCredential,
  type Credential,
} from "./records";
import { decodeBase32, encodeBase32 } from "./otp";
import { fromBase64 } from "./sealing";
export const MAX_TRANSFER_BYTES = 2_000_000;
export function toUri(item: Credential): string {
  const label = item.provider ? `${item.provider}:${item.login}` : item.login;
  const params = new URLSearchParams({
    secret: item.secret,
    algorithm: item.hash.replace("-", ""),
    digits: String(item.digits),
    issuer: item.provider,
  });
  if (item.mode === "hotp") params.set("counter", String(item.counter));
  else params.set("period", String(item.interval));
  if (item.mode === "steam") params.set("encoder", "steam");
  return `otpauth://${item.mode === "hotp" ? "hotp" : "totp"}/${encodeURIComponent(label)}?${params}`;
}
export function fromUri(text: string): Credential {
  let uri: URL;
  try {
    uri = new URL(text);
  } catch {
    throw new InputError("invalid");
  }
  if (uri.protocol !== "otpauth:" || !["totp", "hotp"].includes(uri.hostname))
    throw new InputError("invalid");
  const label = decodeURIComponent(uri.pathname.slice(1));
  const issuer = uri.searchParams.get("issuer");
  const divider =
    issuer === ""
      ? -1
      : issuer && label.startsWith(issuer + ":")
        ? issuer.length
        : label.indexOf(":");
  const number = (key: string, fallback: number) => {
    if (!uri.searchParams.has(key)) return fallback;
    const value = uri.searchParams.get(key)!;
    if (!/^\d+$/.test(value)) throw new InputError("invalid");
    return Number(value);
  };
  const algorithm = (uri.searchParams.get("algorithm") ?? "SHA1")
    .toUpperCase()
    .replace("-", "");
  if (!["SHA1", "SHA256", "SHA512"].includes(algorithm))
    throw new InputError("invalid");
  if (uri.hostname === "hotp" && !uri.searchParams.has("counter"))
    throw new InputError("invalid");
  const item = validateCredential({
    provider:
      uri.searchParams.get("issuer") ??
      (divider >= 0 ? label.slice(0, divider) : ""),
    login: divider >= 0 ? label.slice(divider + 1) : label,
    secret: uri.searchParams.get("secret"),
    mode: uri.searchParams.get("encoder") === "steam" ? "steam" : uri.hostname,
    hash: algorithm.replace("SHA", "SHA-"),
    digits: number("digits", 6),
    interval: number("period", 30),
    counter: number("counter", 0),
  });
  decodeBase32(item.secret);
  return item;
}
export async function parseTransfer(text: string): Promise<Credential[]> {
  if (new TextEncoder().encode(text).length > MAX_TRANSFER_BYTES)
    throw new InputError("invalid");
  const clean = text.trim();
  let candidates: Credential[];
  if (clean.startsWith("{") || clean.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(clean);
    } catch {
      throw new InputError("invalid");
    }
    const object = parsed as Record<string, unknown> | null;
    const items = Array.isArray(parsed)
      ? parsed
      : (object?.entries ??
        object?.records ??
        object?.accounts ??
        (object?.data as Record<string, unknown> | undefined)?.accounts);
    if (!Array.isArray(items) || items.length > 1000)
      throw new InputError("invalid");
    candidates = items.map((raw: unknown) => {
      if (!raw || typeof raw !== "object") throw new InputError("invalid");
      const x = raw as Record<string, unknown>;
      return validateCredential({
        ...x,
        provider: x.provider ?? x.issuer,
        login: x.login ?? x.label ?? x.account,
        mode: x.mode ?? x.type,
        hash: x.hash ?? x.algorithm,
        interval: x.interval ?? x.period,
        position: x.position ?? x.sortOrder,
      });
    });
  } else {
    const lines: string[] = [];
    for (const raw of clean.split("\n")) {
      const entry = raw.trim();
      if (entry) lines.push(entry);
    }
    if (!lines.length || lines.length > 1000) throw new InputError("invalid");
    candidates = [];
    for (const line of lines) {
      candidates.push(
        ...(line.startsWith("otpauth-migration:")
          ? readMigration(line)
          : [fromUri(line)]),
      );
      if (candidates.length > 1000) throw new InputError("invalid");
    }
  }
  return Promise.all(
    candidates.map(async (item) => {
      decodeBase32(item.secret);
      return identify(item);
    }),
  );
}
// Google migration uses protobuf wire types; reject truncated and oversized fields.
function fields(bytes: Uint8Array): Map<number, (Uint8Array | bigint)[]> {
  const result = new Map<number, (Uint8Array | bigint)[]>();
  let cursor = 0;
  const integer = () => {
    let value = 0n;
    for (let shift = 0n; shift < 70n; shift += 7n) {
      if (cursor >= bytes.length) throw new InputError("invalid");
      const b = bytes[cursor++]!;
      if (shift === 63n && b > 1) throw new InputError("invalid");
      value |= BigInt(b & 127) << shift;
      if (!(b & 128)) return value;
    }
    throw new InputError("invalid");
  };
  while (cursor < bytes.length) {
    const tag = integer();
    const number = Number(tag >> 3n);
    if (number < 1 || number > 536870911) throw new InputError("invalid");
    let value: Uint8Array | bigint;
    switch (Number(tag & 7n)) {
      case 0:
        value = integer();
        break;
      case 2: {
        const size = Number(integer());
        if (!Number.isSafeInteger(size) || size > bytes.length - cursor)
          throw new InputError("invalid");
        value = bytes.slice(cursor, cursor + size);
        cursor += size;
        break;
      }
      case 1:
        cursor += 8;
        if (cursor > bytes.length) throw new InputError("invalid");
        continue;
      case 5:
        cursor += 4;
        if (cursor > bytes.length) throw new InputError("invalid");
        continue;
      default:
        throw new InputError("invalid");
    }
    result.set(number, [...(result.get(number) ?? []), value]);
  }
  return result;
}
function readMigration(text: string): Credential[] {
  const url = new URL(text);
  if (url.hostname !== "offline") throw new InputError("invalid");
  const data = (url.searchParams.get("data") ?? "").replace(/ /g, "+");
  if (data.length > 65536) throw new InputError("invalid");
  const payload = fromBase64(data, 65536);
  const root = fields(payload);
  const rows = root.get(1) ?? [];
  if (!rows.length || rows.length > 200) throw new InputError("invalid");
  return rows.map((row) => {
    if (!(row instanceof Uint8Array)) throw new InputError("invalid");
    const x = fields(row);
    const str = (key: number) => {
      const value = x.get(key)?.[0];
      return value instanceof Uint8Array
        ? new TextDecoder("utf-8", { fatal: true }).decode(value)
        : "";
    };
    const num = (key: number, fallback: bigint) => {
      const value = x.get(key)?.[0] ?? fallback;
      if (typeof value !== "bigint" || value > BigInt(Number.MAX_SAFE_INTEGER))
        throw new InputError("invalid");
      return Number(value);
    };
    const secret = x.get(1)?.[0];
    if (!(secret instanceof Uint8Array)) throw new InputError("invalid");
    const algorithm = num(4, 1n);
    const digits = num(5, 1n);
    const type = num(6, 2n);
    if (
      ![1, 2, 3].includes(algorithm) ||
      ![1, 2].includes(digits) ||
      ![1, 2].includes(type)
    )
      throw new InputError("invalid");
    const name = str(2),
      issuer = str(3);
    const login =
      issuer && name.startsWith(issuer + ":")
        ? name.slice(issuer.length + 1)
        : name;
    return validateCredential({
      provider: issuer,
      login,
      secret: encodeBase32(secret),
      hash: ["", "SHA-1", "SHA-256", "SHA-512"][algorithm],
      digits: digits === 1 ? 6 : 8,
      mode: type === 1 ? "hotp" : "totp",
      counter: num(7, 0n),
    });
  });
}

export function accountToOtpAuthUri(
  account: import("./view").AuthenticatorAccount,
): string {
  return toUri(
    validateCredential({
      provider: account.issuer,
      login: account.label,
      secret: account.secret,
      mode: account.type,
      hash: account.algorithm,
      digits: account.digits,
      interval: account.period,
      counter: account.counter,
    }),
  );
}
