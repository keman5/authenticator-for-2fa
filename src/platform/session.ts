import { cacheIsOpen } from "../domain/locking";
import type { Workspace } from "../domain/records";
export const PANEL_LEASE = "keman5.authenticator.workspace.panel.v2";
interface Lease {
  proof: string;
  until: number;
  lockedAt: number;
}
function area() {
  return typeof chrome === "undefined" ? undefined : chrome.storage?.session;
}
export async function clearVaultSessionKey() {
  const storage = area();
  if (storage)
    await new Promise<void>((resolve) =>
      storage.remove(PANEL_LEASE, () => resolve()),
    );
}
export async function renewPanelLease(
  space: Workspace,
  authorizedUntil = Infinity,
) {
  const storage = area();
  if (!storage || !space.gate) return;
  const lease: Lease = {
    proof: space.gate.proof,
    until: Math.min(Date.now() + 3000, authorizedUntil),
    lockedAt: space.gate.lockedAt ?? 0,
  };
  await new Promise<void>((resolve, reject) =>
    storage.set({ [PANEL_LEASE]: lease }, () =>
      chrome.runtime.lastError
        ? reject(new Error(chrome.runtime.lastError.message))
        : resolve(),
    ),
  );
}
export async function canUseWorkspace(space: Workspace): Promise<boolean> {
  if (cacheIsOpen(space.gate)) return true;
  if (!space.gate) return true;
  const storage = area();
  if (!storage) return false;
  const lease = await new Promise<Lease | undefined>((resolve) =>
    storage.get(PANEL_LEASE, (items) =>
      resolve(items[PANEL_LEASE] as Lease | undefined),
    ),
  );
  return Boolean(
    lease &&
    lease.proof === space.gate.proof &&
    lease.lockedAt === (space.gate.lockedAt ?? 0) &&
    lease.until > Date.now() &&
    lease.until <= Date.now() + 3000,
  );
}
