import {
  InputError,
  identity,
  mergeRecords,
  validateCredential,
  type Credential,
  type Workspace,
} from "../domain/records";
import {
  fromBase64,
  toBase64,
  rawKey,
  seal,
  unseal,
  type Sealed,
} from "../domain/sealing";
export function syncSupported(): boolean {
  return (
    typeof chrome !== "undefined" &&
    Boolean(chrome.storage?.sync) &&
    !(chrome.runtime.getURL?.("") ?? "").startsWith("safari-web-extension:")
  );
}
export function recoveryKey(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}
export async function groupFor(key: string): Promise<string> {
  const bytes = fromBase64(key.trim(), 64);
  if (bytes.length !== 32) throw new InputError("invalid");
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  )
    .join("")
    .slice(0, 32);
}
export function syncNamespace(group: string): string {
  return `keman5.authenticator.sync2.${group}.`;
}
export async function connect(
  space: Workspace,
  key: string,
  existing: boolean,
): Promise<void> {
  if (!syncSupported()) throw new InputError("unavailable");
  const group = await groupFor(key);
  const connection = { key: key.trim(), group };
  const remote = await cloudRead();
  const name = syncNamespace(group) + "hello";
  if (existing && !remote[name]) throw new InputError("missingGroup");
  if (remote[name]) {
    const marker = await unseal(
      remote[name] as Sealed,
      await rawKey(key.trim()),
      name,
    );
    if (marker === "authenticator.sync/2/deleted")
      throw new InputError("missingGroup");
    if (marker !== "authenticator.sync/2") throw new InputError("invalid");
  }
  space.connection = connection;
  await synchronize(space, remote);
}
async function cloudRead(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) =>
    chrome.storage.sync.get(null, (items) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(items);
    }),
  );
}
export async function synchronize(
  space: Workspace,
  existing?: Record<string, unknown>,
): Promise<void> {
  if (!space.connection) return;
  if (!syncSupported()) throw new InputError("unavailable");
  const { key: encoded, group } = space.connection;
  if ((await groupFor(encoded)) !== group) throw new InputError("invalid");
  const key = await rawKey(encoded);
  const prefix = syncNamespace(group);
  const remote = existing ?? (await cloudRead());
  const marker = remote[prefix + "hello"];
  if (marker) {
    const state = await unseal(marker as Sealed, key, prefix + "hello");
    if (state === "authenticator.sync/2/deleted") {
      delete space.connection;
      return;
    }
    if (state !== "authenticator.sync/2") throw new InputError("invalid");
  }
  const decoded: Record<string, Credential> = {};
  for (const [name, box] of Object.entries(remote)) {
    if (!name.startsWith(prefix) || name === prefix + "hello") continue;
    const id = name.slice(prefix.length);
    if (!/^[a-f0-9]{64}$/.test(id)) throw new InputError("invalid");
    const item = validateCredential(await unseal(box as Sealed, key, name));
    if (item.id !== id) throw new InputError("invalid");
    decoded[id] = item;
  }
  let local = space.records;
  if (existing) {
    // Joining also reconciles older backups that did not retain stable IDs.
    local = { ...local };
    const remoteIdentities = new Map(
      Object.values(decoded)
        .filter((item) => !item.removed)
        .map((item) => [identity(item), item.id]),
    );
    for (const item of Object.values(local)) {
      const id = remoteIdentities.get(identity(item));
      if (!item.removed && id && !decoded[item.id] && !local[id]) {
        delete local[item.id];
        local[id] = { ...item, id };
      }
    }
  }
  const merged = mergeRecords(local, decoded);
  const updates: Record<string, Sealed> = {};
  const markerName = prefix + "hello";
  if (!remote[markerName])
    updates[markerName] = await seal("authenticator.sync/2", key, markerName);
  for (const [id, item] of Object.entries(merged)) {
    if (
      JSON.stringify({ ...item, position: 0 }) !==
      JSON.stringify({ ...decoded[id], position: 0 })
    )
      updates[prefix + id] = await seal(item, key, prefix + id);
  }
  if (Object.keys(updates).length) {
    const bytes = (name: string, value: unknown) =>
      new TextEncoder().encode(name + JSON.stringify(value)).length;
    const limit = chrome.storage.sync.QUOTA_BYTES_PER_ITEM ?? 8192;
    const budget = chrome.storage.sync.QUOTA_BYTES ?? 102400;
    if (
      Object.keys({ ...remote, ...updates }).length >
        (chrome.storage.sync.MAX_ITEMS ?? 512) ||
      Object.entries(updates).some(
        ([name, value]) => bytes(name, value) > limit,
      ) ||
      Object.entries({ ...remote, ...updates }).reduce(
        (sum, [name, value]) => sum + bytes(name, value),
        0,
      ) > budget
    )
      throw new InputError("quota");
    await new Promise<void>((resolve, reject) =>
      chrome.storage.sync.set(updates, () => {
        const error = chrome.runtime.lastError;
        if (error)
          reject(
            new InputError(
              /quota|MAX_/i.test(error.message ?? "") ? "quota" : "unavailable",
            ),
          );
        else resolve();
      }),
    );
  }
  let position =
    Math.max(0, ...Object.values(local).map((item) => item.position)) + 1;
  space.records = Object.fromEntries(
    Object.entries(merged).map(([id, item]) => [
      id,
      { ...item, position: local[id]?.position ?? position++ },
    ]),
  );
}

export type BrowserSyncErrorCode =
  | "unavailable"
  | "passwordRequired"
  | "invalidKey"
  | "notFound"
  | "quota"
  | "invalidData"
  | "storage";
export const generateSyncRecoveryKey = recoveryKey;
export function parseSyncRecoveryKey(value: string): string {
  const clean = value.trim().replace(/\s+/g, "");
  if (fromBase64(clean, 64).length !== 32) throw new InputError("invalid");
  return clean;
}

export async function deleteSyncGroup(space: Workspace): Promise<void> {
  if (!space.connection) return;
  const { key: encoded, group } = space.connection;
  if ((await groupFor(encoded)) !== group) throw new InputError("invalid");
  const prefix = syncNamespace(group),
    name = prefix + "hello";
  const tombstone = await seal(
    "authenticator.sync/2/deleted",
    await rawKey(encoded),
    name,
  );
  await new Promise<void>((resolve, reject) =>
    chrome.storage.sync.set({ [name]: tombstone }, () =>
      chrome.runtime.lastError
        ? reject(new Error(chrome.runtime.lastError.message))
        : resolve(),
    ),
  );
  const remote = await cloudRead();
  const keys = Object.keys(remote).filter(
    (key) => key.startsWith(prefix) && key !== name,
  );
  if (keys.length)
    await new Promise<void>((resolve, reject) =>
      chrome.storage.sync.remove(keys, () =>
        chrome.runtime.lastError
          ? reject(new Error(chrome.runtime.lastError.message))
          : resolve(),
      ),
    );
  delete space.connection;
}
