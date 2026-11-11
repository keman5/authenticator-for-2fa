import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AuthenticatorVault } from "../src/platform/controller";
import {
  readWorkspace,
  transaction,
  validateWorkspace,
  DOCUMENT_KEY,
} from "../src/platform/repository";
import { newGate } from "../src/domain/sealing";
import * as sealing from "../src/domain/sealing";
import * as passkeys from "../src/platform/passkey";
import * as biometric from "../src/platform/touchID";
import { canUseWorkspace } from "../src/platform/session";
import {
  installMemoryStorage,
  installStructuredCloneChromeStorage,
} from "./helpers/storage";

beforeEach(() => {
  installMemoryStorage();
  installStructuredCloneChromeStorage();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const draft = { issuer: "Example", label: "alice", secret: "JBSWY3DPEHPK3PXP" };
async function protectedVault(duration = 0) {
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.addAccount(draft);
  await vault.changePassword("", "1");
  await vault.updateSettings({ autoLockMinutes: duration });
  return vault;
}
function directUrl() {
  let href = "https://extension.test/index.html?entry=quick";
  vi.stubGlobal("location", {
    get href() {
      return href;
    },
  });
  vi.stubGlobal("history", {
    replaceState: (_: unknown, __: string, url: string) => {
      href = url;
    },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test("starts without a password and accepts a one character interface lock", async () => {
  const vault = await protectedVault();
  expect(vault.passwordProtected).toBe(true);
  expect(vault.locked).toBe(false);
  expect(Object.values((await readWorkspace()).records)[0]?.secret).toBe(
    draft.secret,
  );
  await vault.lock();
  expect(vault.accounts).toEqual([]);
  expect(vault.codes).toEqual({});
  await vault.unlock("wrong");
  expect(vault.locked).toBe(true);
  await vault.unlock("1");
  expect(vault.locked).toBe(false);
  expect(vault.accounts).toHaveLength(1);
});
test("rejects empty passwords without altering existing accounts", async () => {
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.addAccount(draft);
  await vault.changePassword("", "");
  expect(vault.error).not.toBe("");
  expect((await readWorkspace()).gate).toBeUndefined();
  expect(vault.accounts).toHaveLength(1);
});
test.each([false, true])(
  "old direct-entry URLs and stored bypass=%s cannot unlock a protected vault",
  async (quick) => {
    const vault = await protectedVault();
    await vault.lock();
    const workspace = await readWorkspace();
    await new Promise<void>((resolve) =>
      chrome.storage.local.set(
        {
          [DOCUMENT_KEY]: { ...workspace, gate: { ...workspace.gate, quick } },
        },
        resolve,
      ),
    );
    directUrl();
    const reopened = new AuthenticatorVault();
    await reopened.initialize();
    expect(reopened.locked).toBe(true);
    expect(reopened.accounts).toEqual([]);
    expect(reopened.codes).toEqual({});
    expect(await canUseWorkspace(await readWorkspace())).toBe(false);
    expect((await readWorkspace()).gate).not.toHaveProperty("quick");
    await reopened.unlock("1");
    expect(reopened.accounts).toHaveLength(1);
  },
);
test("a late password check cannot undo manual locking or persist an unlock timestamp", async () => {
  const vault = await protectedVault();
  await vault.lock();
  const check = deferred<boolean>();
  vi.spyOn(sealing, "checkGate").mockReturnValue(check.promise);
  const unlocking = vault.unlock("1");
  await vi.waitFor(() => expect(sealing.checkGate).toHaveBeenCalled());
  const locking = vault.lock();
  check.resolve(true);
  await Promise.all([unlocking, locking]);
  expect(vault.locked).toBe(true);
  expect((await readWorkspace()).gate?.unlockedAt).toBeUndefined();
  expect(vault.busy).toBe(false);
});
test("a late password change cannot commit after locking", async () => {
  const vault = await protectedVault();
  const before = (await readWorkspace()).gate?.proof;
  const check = deferred<boolean>();
  vi.spyOn(sealing, "checkGate").mockReturnValue(check.promise);
  const changing = vault.changePassword("1", "2");
  await vi.waitFor(() => expect(sealing.checkGate).toHaveBeenCalled());
  const locking = vault.lock();
  check.resolve(true);
  await Promise.all([changing, locking]);
  expect(vault.locked).toBe(true);
  expect((await readWorkspace()).gate?.proof).toBe(before);
});
test("late passkey verification cannot reopen a manually locked panel", async () => {
  const vault = await protectedVault();
  await vault.lock();
  const request = deferred<ArrayBuffer>();
  vi.spyOn(passkeys, "readPasskeyKey").mockReturnValue(request.promise);
  const unlocking = vault.unlockPasskey();
  await vi.waitFor(() => expect(passkeys.readPasskeyKey).toHaveBeenCalled());
  await vault.lock();
  request.resolve(new ArrayBuffer(32));
  await unlocking;
  expect(vault.locked).toBe(true);
  expect((await readWorkspace()).gate?.unlockedAt).toBeUndefined();
});
test("late native verification cannot reopen a manually locked panel", async () => {
  const vault = await protectedVault();
  await transaction((space) => {
    space.gate!.touchID = true;
  });
  await vault.initialize();
  await vault.lock();
  vi.spyOn(biometric, "touchIDWindow").mockResolvedValue(false);
  const request = deferred<void>();
  vi.spyOn(biometric, "touchID").mockReturnValue(request.promise);
  const unlocking = vault.unlockTouchID();
  await vi.waitFor(() => expect(biometric.touchID).toHaveBeenCalled());
  await vault.lock();
  request.resolve();
  await unlocking;
  expect(vault.locked).toBe(true);
  expect((await readWorkspace()).gate?.unlockedAt).toBeUndefined();
});
test("an explicit lock invalidates a background page lease", async () => {
  const vault = await protectedVault();
  await vault.refreshCodes();
  expect(await canUseWorkspace(await readWorkspace())).toBe(true);
  await vault.lock();
  expect(await canUseWorkspace(await readWorkspace())).toBe(false);
});
test("malformed manual lock stamps are rejected at storage boundaries", async () => {
  const gate = await newGate("1");
  const workspace = await readWorkspace();
  for (const lockedAt of [-1, 0, NaN, 1.5, Infinity])
    expect(() =>
      validateWorkspace({ ...workspace, gate: { ...gate, lockedAt } }),
    ).toThrow("corrupt");
});
test("upgrading a 30-second lock uses one minute and requires a fresh unlock", async () => {
  const gate = await newGate("1");
  const workspace = await readWorkspace();
  await new Promise<void>((resolve) =>
    chrome.storage.local.set(
      {
        [DOCUMENT_KEY]: {
          ...workspace,
          gate: { ...gate, lockAfter: 30, unlockedAt: Date.now() },
        },
      },
      resolve,
    ),
  );

  const vault = new AuthenticatorVault();
  await vault.initialize();
  expect(vault.locked).toBe(true);
  expect(vault.settings.autoLockMinutes).toBe(1);
  await vault.unlock("1");
  expect(vault.locked).toBe(false);
  expect((await readWorkspace()).gate).toMatchObject({
    lockAfter: 60,
    unlockedAt: expect.any(Number),
  });
});
test("stale editor, reorder and delete operations cannot overwrite newer account data", async () => {
  const vault = new AuthenticatorVault();
  await vault.initialize();
  const old = await vault.addAccount(draft);
  await vault.updateAccount(old, { label: "bob" });
  await expect(vault.updateAccount(old, { label: "stale" })).rejects.toThrow(
    "changed",
  );
  await expect(vault.deleteAccount(old)).rejects.toThrow("changed");
  await expect(vault.reorderAccounts([old.id, old.id])).rejects.toThrow(
    "changed",
  );
  expect(vault.accounts[0]?.label).toBe("bob");
});
test("the controller notifies React subscribers when async code generation completes", async () => {
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.addAccount(draft);
  const listener = vi.fn();
  const stop = vault.subscribe(listener);
  await vault.refreshCodes();
  expect(listener).toHaveBeenCalled();
  expect(vault.codes[vault.accounts[0]!.id]?.value).toMatch(/^\d{6}$/);
  stop();
});
