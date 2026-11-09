import type { Gate } from "./records";
export const LOCK_DURATIONS = [
  0,
  30,
  ...Array.from({ length: 10 }, (_, i) => (i + 1) * 60),
  1800,
  ...Array.from({ length: 24 }, (_, i) => (i + 1) * 3600),
  ...Array.from({ length: 28 }, (_, i) => (i + 3) * 86400),
  -1,
] as const;
export function lockDuration(gate: Gate): number {
  return gate.lockAfter ?? 0;
}
export function cacheIsOpen(gate: Gate | undefined, now = Date.now()): boolean {
  if (!gate) return true;
  const duration = lockDuration(gate),
    stamp = gate.unlockedAt;
  if (duration === 0 || stamp === undefined || stamp <= 0 || stamp > now)
    return false;
  return duration === -1 || now - stamp < duration * 1000;
}
export function panelExpired(
  gate: Gate | undefined,
  openedAt: number | undefined,
  now = Date.now(),
): boolean {
  if (!gate) return false;
  const duration = lockDuration(gate);
  if (duration === 0 || duration === -1) return false;
  return (
    openedAt === undefined ||
    openedAt > now ||
    now - openedAt >= duration * 1000
  );
}
