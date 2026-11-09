import { describe, it, expect } from "vitest";
import { codeFor, encodeBase32, decodeBase32 } from "../src/domain/otp";
import {
  activeRecords,
  emptyWorkspace,
  identify,
  insertRecords,
  mergeRecords,
  moveRecord,
  reviseRecord,
  validateCredential,
  matchesSite,
} from "../src/domain/records";
import { parseTransfer, toUri } from "../src/domain/transfer";
import {
  newGate,
  checkGate,
  encryptedBackup,
  openBackup,
  fromBase64,
  toBase64,
} from "../src/domain/sealing";
const secret = encodeBase32(new TextEncoder().encode("12345678901234567890"));
const credential = (data = {}) =>
  validateCredential({
    login: "alice@example.com",
    provider: "Example",
    secret,
    ...data,
  });
describe("standards", () => {
  it("RFC 4226 ten HOTP counters", async () => {
    const expected = [
      "755224",
      "287082",
      "359152",
      "969429",
      "338314",
      "254676",
      "287922",
      "162583",
      "399871",
      "520489",
    ];
    for (const [counter, code] of expected.entries())
      expect(await codeFor(credential({ mode: "hotp", counter }))).toBe(code);
  });
  it("RFC 6238 all three HMAC variants", async () => {
    const times = [
      59, 1111111109, 1111111111, 1234567890, 2000000000, 20000000000,
    ];
    const vectors = {
      "SHA-1": [
        "94287082",
        "07081804",
        "14050471",
        "89005924",
        "69279037",
        "65353130",
      ],
      "SHA-256": [
        "46119246",
        "68084774",
        "67062674",
        "91819424",
        "90698825",
        "77737706",
      ],
      "SHA-512": [
        "90693936",
        "25091201",
        "99943326",
        "93441116",
        "38618901",
        "47863826",
      ],
    };
    for (const [hash, codes] of Object.entries(vectors)) {
      const size = hash === "SHA-1" ? 20 : hash === "SHA-256" ? 32 : 64;
      const bytes = new TextEncoder().encode(
        "1234567890".repeat(7).slice(0, size),
      );
      for (const [i, time] of times.entries())
        expect(
          await codeFor(
            credential({ secret: encodeBase32(bytes), hash, digits: 8 }),
            time * 1000,
          ),
        ).toBe(codes[i]);
    }
  });
  it("canonical base32 and Steam alphabet", async () => {
    for (const text of ["f", "fo", "foo", "foob", "fooba", "foobar"])
      expect(
        new TextDecoder().decode(
          decodeBase32(encodeBase32(new TextEncoder().encode(text))),
        ),
      ).toBe(text);
    expect(decodeBase32("MZ")).toEqual(decodeBase32("MY"));
    expect(() => decodeBase32("A")).toThrow();
    expect(await codeFor(credential({ mode: "steam" }), 59000)).toMatch(
      /^[23456789BCDFGHJKMNPQRTVWXY]{5}$/,
    );
  });
  it("URI roundtrip and old JSON interchange", async () => {
    const item = await identify(
      credential({ mode: "hotp", counter: 27, hash: "SHA-512", digits: 8 }),
    );
    const [copy] = await parseTransfer(toUri(item));
    expect(copy).toEqual(item);
    const [old] = await parseTransfer(
      JSON.stringify({
        accounts: [
          {
            issuer: "Example",
            label: "alice@example.com",
            secret,
            type: "totp",
            algorithm: "SHA-1",
            period: 30,
          },
        ],
      }),
    );
    expect(old?.login).toBe(item.login);
    expect(old?.secret).toBe(secret);
  });
  it("rejects a whole malformed batch", async () => {
    await expect(
      parseTransfer(
        JSON.stringify([credential(), { ...credential(), secret: "!!" }]),
      ),
    ).rejects.toThrow();
    await expect(
      parseTransfer("otpauth://hotp/alice?secret=" + secret),
    ).rejects.toThrow();
    await expect(
      parseTransfer("otpauth://totp/alice?secret=" + secret + "&period=-1"),
    ).rejects.toThrow();
    await expect(parseTransfer("x".repeat(2_000_001))).rejects.toThrow();
  });
  it("decodes a Google migration protobuf including counter", async () => {
    const field = (id: number, bytes: Uint8Array) =>
      new Uint8Array([id * 8 + 2, bytes.length, ...bytes]);
    const str = (id: number, text: string) =>
      field(id, new TextEncoder().encode(text));
    const row = new Uint8Array([
      ...field(1, decodeBase32(secret)),
      ...str(2, "Example:alice"),
      ...str(3, "Example"),
      32,
      1,
      40,
      1,
      48,
      1,
      56,
      9,
    ]);
    const [item] = await parseTransfer(
      "otpauth-migration://offline?data=" +
        encodeURIComponent(toBase64(field(1, row))),
    );
    expect(item?.login).toBe("alice");
    expect(item?.mode).toBe("hotp");
    expect(item?.counter).toBe(9);
    await expect(
      parseTransfer(
        "otpauth-migration://offline?data=" +
          toBase64(new Uint8Array([10, 255])),
      ),
    ).rejects.toThrow();
  });
});
describe("record transactions", () => {
  it("deduplicates, moves, rejects stale editors, restores deletion", async () => {
    const a = await identify(credential()),
      b = await identify(credential({ login: "bob" }));
    const space = emptyWorkspace();
    expect(insertRecords(space, [a, b, a])).toEqual({ added: 2, skipped: 1 });
    moveRecord(space, b.id, a.id);
    expect(activeRecords(space)[0]?.id).toBe(b.id);
    const original = { ...space.records[a.id]! };
    reviseRecord(space, original, { ...original, login: "new" });
    expect(() => reviseRecord(space, original, original)).toThrow("stale");
    space.records[b.id] = { ...space.records[b.id]!, removed: true };
    expect(insertRecords(space, [b]).added).toBe(1);
    expect(space.records[b.id]?.removed).toBe(false);
  });
  it("converges independent of merge order and keeps deletions", async () => {
    const a = await identify(credential());
    const b = { ...a, login: "renamed", changed: 10 };
    const c = { ...a, removed: true, changed: 11 };
    expect(mergeRecords({ [a.id]: b }, { [a.id]: c })).toEqual(
      mergeRecords({ [a.id]: c }, { [a.id]: b }),
    );
    expect(mergeRecords({ [a.id]: b }, { [a.id]: c })[a.id]?.removed).toBe(
      true,
    );
    const tie = { ...b, login: "z" };
    expect(mergeRecords({ [a.id]: b }, { [a.id]: tie })).toEqual(
      mergeRecords({ [a.id]: tie }, { [a.id]: b }),
    );
  });
  it("limits hostname matching to domain boundaries", () => {
    const item = credential({ site: "example.com" });
    expect(matchesSite(item, "login.example.com")).toBe(true);
    expect(matchesSite(item, "badexample.com")).toBe(false);
    expect(matchesSite(item, "example.com.attacker.test")).toBe(false);
  });
});
describe("screen lock and encrypted portable copies", () => {
  it("starts unprotected and accepts one character passwords", async () => {
    expect(emptyWorkspace().gate).toBeUndefined();
    const gate = await newGate("x");
    expect(await checkGate(gate, "x")).toBe(true);
    expect(await checkGate(gate, "wrong")).toBe(false);
    expect(await checkGate(gate, "")).toBe(false);
    expect(JSON.stringify(gate)).not.toContain('"x"');
    await expect(newGate("")).rejects.toThrow("emptyPassword");
  });
  it("encrypts, authenticates, and rejects unbounded KDF work", async () => {
    const data = { entries: [credential()] };
    const encoded = await encryptedBackup(data, "1");
    expect(encoded).not.toContain(secret);
    const box = JSON.parse(encoded);
    expect(await openBackup(box, "1")).toEqual(data);
    const legacy = {
      vault: {
        version: 1,
        kdf: {
          name: "PBKDF2",
          hash: "SHA-256",
          iterations: box.rounds,
          salt: box.salt,
        },
        cipher: { name: "AES-GCM", iv: box.iv, data: box.payload },
      },
    };
    expect(await openBackup(legacy, "1")).toEqual(data);
    await expect(openBackup(box, "2")).rejects.toThrow("password");
    box.payload = toBase64(
      Uint8Array.from(fromBase64(box.payload), (value, i) =>
        i ? value : value ^ 1,
      ),
    );
    await expect(openBackup(box, "1")).rejects.toThrow("password");
    box.rounds = 2_000_000;
    await expect(openBackup(box, "1")).rejects.toThrow("invalid");
  });
});
