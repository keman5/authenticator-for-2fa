import { it, expect } from "vitest";
import {
  LOCK_DURATIONS,
  cacheIsOpen,
  panelExpired,
} from "../src/domain/locking";
import type { Gate } from "../src/domain/records";
const now = 1_800_000_000_000;
const gate = (lockAfter = 0, unlockedAt: number | undefined = now): Gate => ({
  salt: "",
  proof: "",
  lockAfter,
  unlockedAt,
});
it("offers exactly the requested durations plus close-to-lock", () => {
  expect([...LOCK_DURATIONS]).toEqual([
    0,
    ...Array.from({ length: 10 }, (_, i) => (i + 1) * 60),
    1800,
    ...Array.from({ length: 24 }, (_, i) => (i + 1) * 3600),
    ...Array.from({ length: 28 }, (_, i) => (i + 3) * 86400),
    -1,
  ]);
});
it.each(LOCK_DURATIONS.filter((value) => value > 0))(
  "expires %s seconds after authentication, at the exact boundary",
  (duration) => {
    const value = gate(duration);
    expect(cacheIsOpen(value, now + duration * 1000 - 1)).toBe(true);
    expect(cacheIsOpen(value, now + duration * 1000)).toBe(false);
    expect(panelExpired(value, now, now + duration * 1000 - 1)).toBe(false);
    expect(panelExpired(value, now, now + duration * 1000)).toBe(true);
  },
);
it("default closes without caching, permanent still requires a successful unlock", () => {
  expect(cacheIsOpen(gate(), now)).toBe(false);
  expect(panelExpired(gate(), now, now + 99_999_999)).toBe(false);
  expect(cacheIsOpen({ ...gate(-1), unlockedAt: undefined }, now)).toBe(false);
  expect(cacheIsOpen(gate(-1), now + 31 * 86400_000)).toBe(true);
  expect(cacheIsOpen(gate(60, now + 1), now)).toBe(false);
  expect(panelExpired(gate(60), now + 1, now)).toBe(true);
  expect(cacheIsOpen(undefined, now)).toBe(true);
});
it("a fresh successful unlock restarts the deadline; clearing the timestamp locks immediately", () => {
  const value = gate(60, now - 60_000);
  expect(cacheIsOpen(value, now)).toBe(false);
  value.unlockedAt = now;
  expect(cacheIsOpen(value, now)).toBe(true);
  delete value.unlockedAt;
  expect(cacheIsOpen(value, now)).toBe(false);
});
