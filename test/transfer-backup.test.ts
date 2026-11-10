import { afterEach, expect, test, vi } from "vitest";
import { codeFor } from "../src/domain/otp";
import { fromUri, parseTransfer, toUri } from "../src/domain/transfer";
import {
  accountDraft,
  DEFAULT_SETTINGS,
  toCredential,
} from "../src/domain/view";
import {
  createEncryptedBackupFile,
  createPlainOtpAuthFile,
  readBackupAccounts,
} from "../src/domain/portable";
import { encryptedBackup, toBase64 } from "../src/domain/sealing";
const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
afterEach(() => vi.restoreAllMocks());
test.each(["C++", "Team + Work", "Test %20", "Team:Ops", ""])(
  "URI round trips preserve issuer %s and colons in account labels",
  (issuer) => {
    const original = toCredential({
      issuer,
      label: "work:alice@example.com",
      secret,
    });
    const parsed = fromUri(toUri(original));
    expect(parsed.provider).toBe(issuer);
    expect(parsed.login).toBe(original.login);
  },
);
test.each([
  "digits=0",
  "digits=abc",
  "period=0",
  "period=-30",
  "period=30.5",
  "counter=",
  "algorithm=MD5",
])("malformed URI parameters are rejected: %s", (parameter) => {
  expect(() =>
    fromUri(
      `otpauth://totp/Example:alice?secret=${secret}&issuer=Example&${parameter}`,
    ),
  ).toThrow();
});
test("TOTP changes exactly at the custom period boundary", async () => {
  const record = fromUri(
    "otpauth://totp/Example:alice?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQGEZA&algorithm=sha-256&digits=8&period=45",
  );
  expect(await codeFor(record, 44999)).toBe("18920136");
  expect(await codeFor(record, 45000)).toBe("46119246");
});
test("legacy noncanonical padding bits retain the same OTP byte material", async () => {
  const record = fromUri(
    "otpauth://totp/Example:alice?secret=j3ww-iv3p%20tgjp-qv5q%20aicm%3D%3D%3D%3D&issuer=Example",
  );
  expect(record.secret).toBe("J3WWIV3PTGJPQV5QAICM");
  expect(await codeFor(record, 59000)).toBe("850668");
});
test("migration input limits run before parsing unbounded protobuf data", async () => {
  await expect(
    parseTransfer(`otpauth-migration://offline?data=${"A".repeat(70000)}`),
  ).rejects.toThrow();
  for (const bytes of [
    new Uint8Array([0]),
    new Uint8Array([10, 127, 1]),
    new Uint8Array([128]),
    new Uint8Array(12).fill(255),
  ])
    await expect(
      parseTransfer(
        `otpauth-migration://offline?data=${encodeURIComponent(toBase64(bytes))}`,
      ),
    ).rejects.toThrow();
});
test("encrypted portable backups preserve accounts and omit local protection and sync credentials", async () => {
  const account = await accountDraft({
    issuer: "Example",
    label: "alice",
    secret,
    favorite: true,
    site: "example.com",
    type: "hotp",
    counter: 42,
  });
  const file = await createEncryptedBackupFile(
    [account],
    DEFAULT_SETTINGS,
    "1",
  );
  const text = await file.blob.text();
  expect(text).not.toContain(secret);
  expect(text).not.toContain("alice");
  expect(await readBackupAccounts(text, "1")).toEqual([account]);
  await expect(readBackupAccounts(text, "wrong")).rejects.toThrow("password");
  const plain = createPlainOtpAuthFile([account]);
  expect((await parseTransfer(await plain.blob.text()))[0]?.counter).toBe(42);
});
test("backup imports validate decrypted account schema and reject excessive KDF work", async () => {
  const invalid = await encryptedBackup(
    { records: [{ login: "broken", secret: "A" }] },
    "1",
  );
  await expect(readBackupAccounts(invalid, "1")).rejects.toThrow();
  const valid = JSON.parse(
    await encryptedBackup({ records: [] }, "1"),
  ) as Record<string, unknown>;
  valid.rounds = 1000001;
  await expect(readBackupAccounts(JSON.stringify(valid), "1")).rejects.toThrow(
    "invalid",
  );
});

test("external account IDs are recomputed instead of replacing existing identities", async () => {
  const account = { login: "alice", secret, id: "a".repeat(64) };
  const [external] = await parseTransfer(
    JSON.stringify({ accounts: [account] }),
  );
  expect(external!.id).not.toBe(account.id);
});

test("native backups reject malformed stable IDs and still accept older backups without IDs", async () => {
  const account = { login: "alice", secret };
  await expect(
    parseTransfer(
      JSON.stringify({
        app: "2fa-authenticator",
        version: 1,
        records: [{ ...account, id: "invalid" }],
      }),
    ),
  ).rejects.toThrow("invalid");
  const legacy = await encryptedBackup({ records: [account] }, "1");
  const accounts = await readBackupAccounts(legacy, "1");
  expect(accounts[0]!.id).toMatch(/^[a-f0-9]{64}$/);
});
