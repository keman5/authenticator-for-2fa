import { LOCK_DURATIONS } from "../domain/locking";
import { fromBase64 } from "../domain/sealing";
import {
  emptyWorkspace,
  InputError,
  validateCredential,
  type Workspace,
} from "../domain/records";
export const DOCUMENT_KEY = "keman5.authenticator.workspace.v2";
let queue: Promise<unknown> = Promise.resolve();
export function browserExtension(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}
export function validateWorkspace(value: unknown): Workspace {
  if (!value || typeof value !== "object") throw new InputError("corrupt");
  const x = value as Workspace;
  if (
    x.schema !== 2 ||
    !x.records ||
    typeof x.records !== "object" ||
    Array.isArray(x.records) ||
    !x.preferences
  )
    throw new InputError("corrupt");
  try {
    const records: Workspace["records"] = {};
    for (const [id, raw] of Object.entries(x.records)) {
      if (!/^[a-f0-9]{64}$/.test(id)) throw new InputError("corrupt");
      const item = validateCredential(raw);
      if (item.id !== id) throw new InputError("corrupt");
      records[id] = item;
    }
    const p = x.preferences;
    const defaults = emptyWorkspace().preferences;
    if (
      !["system", "light", "dark"].includes(p.theme) ||
      typeof p.locale !== "string" ||
      p.locale.length > 16
    )
      throw new InputError("corrupt");
    const result: Workspace = {
      schema: 2,
      records,
      preferences: {
        ...defaults,
        locale: p.locale,
        theme: p.theme,
        conceal: p.conceal === undefined ? defaults.conceal : p.conceal === true,
        seconds: p.seconds === true,
        paste: p.paste === true,
        matchSite: p.matchSite === true,
        languageMode: p.languageMode === "manual" ? "manual" : "system",
        sortMode: p.sortMode === "manual" ? "manual" : "contextual",
        showAll: p.showAll === true,
        inputMenu: p.inputMenu === true,
        passkeyDefault: p.passkeyDefault === true,
        ...(typeof p.lastBackupAt === "string"
          ? { lastBackupAt: p.lastBackupAt }
          : {}),
      },
    };
    if (x.gate !== undefined) {
      if (
        typeof x.gate.salt !== "string" ||
        typeof x.gate.proof !== "string" ||
        (x.gate.touchID !== undefined && typeof x.gate.touchID !== "boolean")
      )
        throw new InputError("corrupt");
      if (
        fromBase64(x.gate.salt, 64).length !== 16 ||
        fromBase64(x.gate.proof, 64).length !== 32
      )
        throw new InputError("corrupt");
      if (
        (x.gate.lockAfter !== undefined &&
          !LOCK_DURATIONS.includes(x.gate.lockAfter)) ||
        (x.gate.lockedAt !== undefined &&
          (!Number.isSafeInteger(x.gate.lockedAt) || x.gate.lockedAt <= 0)) ||
        (x.gate.unlockedAt !== undefined &&
          (!Number.isSafeInteger(x.gate.unlockedAt) || x.gate.unlockedAt <= 0))
      )
        throw new InputError("corrupt");
      result.gate = {
        salt: x.gate.salt,
        proof: x.gate.proof,
        touchID: x.gate.touchID === true,
        lockAfter: x.gate.lockAfter ?? 0,
        ...(Number.isSafeInteger(x.gate.lockedAt) && x.gate.lockedAt! > 0
          ? { lockedAt: x.gate.lockedAt }
          : {}),
        ...(x.gate.unlockedAt === undefined
          ? {}
          : { unlockedAt: x.gate.unlockedAt }),
      };
    }
    if (x.connection !== undefined) {
      if (
        typeof x.connection.key !== "string" ||
        typeof x.connection.group !== "string" ||
        !/^[a-f0-9]{32}$/.test(x.connection.group)
      )
        throw new InputError("corrupt");
      if (fromBase64(x.connection.key, 64).length !== 32)
        throw new InputError("corrupt");
      result.connection = { key: x.connection.key, group: x.connection.group };
    }
    return result;
  } catch {
    throw new InputError("corrupt");
  }
}
export async function readWorkspace(): Promise<Workspace> {
  let value: unknown;
  if (browserExtension()) {
    value = await new Promise<unknown>((resolve, reject) =>
      chrome.storage.local.get(DOCUMENT_KEY, (items) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(items[DOCUMENT_KEY]);
      }),
    );
  } else {
    const raw = localStorage.getItem(DOCUMENT_KEY);
    if (raw !== null) {
      try {
        value = JSON.parse(raw);
      } catch {
        throw new InputError("corrupt");
      }
    }
  }
  return value === undefined ? emptyWorkspace() : validateWorkspace(value);
}
export function transaction<T>(
  change: (workspace: Workspace) => T | Promise<T>,
): Promise<{ workspace: Workspace; result: T }> {
  const work = async () => {
    const workspace = await readWorkspace();
    const result = await change(workspace);
    const plain = validateWorkspace(
      JSON.parse(JSON.stringify(workspace)) as unknown,
    );
    if (browserExtension())
      await new Promise<void>((resolve, reject) =>
        chrome.storage.local.set({ [DOCUMENT_KEY]: plain }, () => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve();
        }),
      );
    else localStorage.setItem(DOCUMENT_KEY, JSON.stringify(plain));
    return { workspace: plain, result };
  };
  const serialized = () =>
    typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request(DOCUMENT_KEY, work)
      : work();
  const result = queue.then(serialized, serialized);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
export function subscribeWorkspace(reload: () => void): () => void {
  if (!browserExtension() || !chrome.storage.onChanged) return () => {};
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area === "local" && changes[DOCUMENT_KEY]) reload();
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
