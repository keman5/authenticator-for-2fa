import { describe, expect, test } from "vitest";
import { parseTransfer } from "../../src/domain/transfer";
import { migrationUri } from "../helpers/migration";

describe("QR payload batches", () => {
  test.each([false, true])(
    "imports six migration QRs together in either order (reverse: %s)",
    async (reverse) => {
      const sizes = [10, 10, 10, 10, 6, 1];
      const names = sizes.map((count, batch) =>
        Array.from({ length: count }, (_, i) => `demo-${batch}-${i}`),
      );
      const payloads = names.map((batch, i) => migrationUri(batch, i));
      const accounts = await parseTransfer(
        (reverse ? payloads.reverse() : payloads).join("\n"),
      );
      expect(accounts).toHaveLength(47);
      expect(new Set(accounts.map((account) => account.id)).size).toBe(47);
      expect(accounts.map((account) => account.login).sort()).toEqual(
        names.flat().sort(),
      );
    },
  );

  test.each([false, true])(
    "imports mixed individual and migration QR payloads (migration first: %s)",
    async (migrationFirst) => {
      const payloads = [
        "otpauth://totp/Example:single?secret=JBSWY3DPEHPK3PXP&issuer=Example",
        migrationUri(["batch-one", "batch-two"]),
      ];
      const accounts = await parseTransfer(
        `\n ${(migrationFirst ? payloads.reverse() : payloads).join("\r\n\n")} \n`,
      );
      expect(accounts.map((account) => account.login).sort()).toEqual([
        "batch-one",
        "batch-two",
        "single",
      ]);
    },
  );

  test("rejects malformed later payloads instead of silently importing the first QR", async () => {
    await expect(
      parseTransfer(
        [
          migrationUri(["valid"]),
          "otpauth-migration://offline?data=not-valid-protobuf",
        ].join("\n"),
      ),
    ).rejects.toThrow("invalid");
  });

  test("applies the account limit to the complete decoded batch", async () => {
    const uri = migrationUri(
      Array.from({ length: 200 }, (_, i) => `demo-${i}`),
    );
    await expect(
      parseTransfer(Array.from({ length: 6 }, () => uri).join("\n")),
    ).rejects.toThrow("invalid");
  });
});
