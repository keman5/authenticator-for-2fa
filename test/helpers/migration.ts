import { decodeBase32 } from "../../src/domain/otp";
import { toBase64 } from "../../src/domain/sealing";

// Synthetic protobuf payloads only; never copy real exported account secrets here.
export function migrationUri(names: string[], batchIndex = 0): string {
  const integer = (value: number): number[] => {
    const bytes: number[] = [];
    do {
      const low = value & 127;
      value = Math.floor(value / 128);
      bytes.push(low | (value ? 128 : 0));
    } while (value);
    return bytes;
  };
  const field = (id: number, data: Uint8Array) => [
    id * 8 + 2,
    ...integer(data.length),
    ...data,
  ];
  const str = (id: number, text: string) =>
    field(id, new TextEncoder().encode(text));
  const records = names.flatMap((name) =>
    field(
      1,
      new Uint8Array([
        ...field(1, decodeBase32("JBSWY3DPEHPK3PXP")),
        ...str(2, `Example:${name}`),
        ...str(3, "Example"),
        32,
        1,
        40,
        1,
        48,
        2,
      ]),
    ),
  );
  const payload = new Uint8Array([
    ...records,
    16,
    1,
    24,
    6,
    32,
    batchIndex,
    40,
    42,
  ]);
  return (
    "otpauth-migration://offline?data=" + encodeURIComponent(toBase64(payload))
  );
}
