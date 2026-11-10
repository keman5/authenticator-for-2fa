import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AuthenticatorVault } from "../src/platform/controller";
import { readWorkspace } from "../src/platform/repository";
import { recoveryKey } from "../src/platform/sync";
import { createBrowserSyncNetwork } from "./helpers/browserSync";
import {
  installMemoryStorage,
  installStructuredCloneChromeStorage,
} from "./helpers/storage";

const original = {
  issuer: "Example",
  label: "alice",
  secret: "JBSWY3DPEHPK3PXP",
};
const replacementSecret = "KRSXG5DSMFWHK3DM";
beforeEach(() => {
  installMemoryStorage();
  installStructuredCloneChromeStorage();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function open() {
  const vault = new AuthenticatorVault();
  await vault.initialize();
  return vault;
}
test.each([false, true])(
  "a later favorite change preserves consumed HOTP counters when advanced device syncs first: %s",
  async (advancedFirst) => {
    const network = createBrowserSyncNetwork();
    const da = network.createDevice(),
      db = network.createDevice();
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    da.install();
    const a = await open();
    await a.addAccount({ ...original, type: "hotp", counter: 0 });
    await a.changePassword("", "1");
    const key = recoveryKey();
    await a.startBrowserSync(key, false);
    db.install();
    const b = await open();
    await b.changePassword("", "1");
    await b.startBrowserSync(key, true);
    const initialCode = b.codes[b.accounts[0].id].value;
    da.install();
    now += 1000;
    await a.advanceHotp(a.accounts[0]);
    if (advancedFirst) await a.syncNow();
    db.install();
    now += 1000;
    await b.updateAccount(b.accounts[0], { favorite: true });
    await b.syncNow();
    da.install();
    await a.syncNow();
    db.install();
    await b.syncNow();
    for (const vault of [a, b]) {
      expect(vault.accounts[0]).toMatchObject({ counter: 1, favorite: true });
      expect(vault.codes[vault.accounts[0].id].value).not.toBe(initialCode);
    }
  },
);
test("reimporting an old QR preserves the edited account and skips its occupied ID", async () => {
  const vault = await open();
  const saved = await vault.addAccount(original);
  await vault.updateAccount(saved, { secret: replacementSecret });
  const before = await readWorkspace();
  const result = await vault.importText(
    `otpauth://totp/Example:alice?secret=${original.secret}&issuer=Example`,
  );
  expect(await readWorkspace()).toEqual(before);
  expect(result).toMatchObject({ imported: 0, skipped: 1 });
  expect(vault.accounts).toHaveLength(1);
  expect(vault.accounts[0]?.secret).toBe(replacementSecret);
  await expect(vault.addAccount(original)).rejects.toThrow("already exists");
});
test("an old settings window changes only its patch before remote notifications arrive", async () => {
  const a = await open(),
    b = await open();
  const listeners = new Set<
    Parameters<typeof chrome.storage.onChanged.addListener>[0]
  >();
  vi.spyOn(chrome.storage.onChanged, "addListener").mockImplementation(
    (listener) => {
      listeners.add(listener);
    },
  );
  vi.spyOn(chrome.storage.onChanged, "removeListener").mockImplementation(
    (listener) => {
      listeners.delete(listener);
    },
  );
  const stopA = a.watchStorage(),
    stopB = b.watchStorage();
  try {
    await a.updateSettings({
      theme: "dark",
      hideCodes: true,
      language: "fr",
      languageMode: "manual",
    });
    await b.updateSettings({ showCountdownSeconds: false });
    expect((await readWorkspace()).preferences).toMatchObject({
      theme: "dark",
      conceal: true,
      locale: "fr",
      languageMode: "manual",
      seconds: false,
    });
    await b.updateSettings({ lastBackupAt: "2026-11-09T00:00:00.000Z" });
    expect((await readWorkspace()).preferences).toMatchObject({
      theme: "dark",
      conceal: true,
      locale: "fr",
      seconds: false,
      lastBackupAt: "2026-11-09T00:00:00.000Z",
    });
    await b.updateSettings({ hideCodes: false, enhancedInputMenu: true });
    expect((await readWorkspace()).preferences).toMatchObject({
      theme: "dark",
      conceal: false,
      inputMenu: true,
    });
  } finally {
    stopA();
    stopB();
  }
});
test.each([false, true])(
  "local sorting preserves another device's secret update regardless of first sync: sorted device %s",
  async (sortedFirst) => {
    const network = createBrowserSyncNetwork(),
      aDevice = network.createDevice(),
      bDevice = network.createDevice();
    let clock = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => clock);
    aDevice.install();
    const a = await open();
    await a.addAccount(original);
    await a.addAccount({ ...original, label: "bob" });
    await a.changePassword("", "1");
    const key = recoveryKey();
    await a.startBrowserSync(key, false);
    bDevice.install();
    const b = await open();
    await b.changePassword("", "1");
    await b.startBrowserSync(key, true);
    aDevice.install();
    clock += 1000;
    await a.updateAccount(
      a.accounts.find((x) => x.label === "alice")!,
      { secret: replacementSecret },
    );
    bDevice.install();
    clock += 1000;
    const order = b.sortedAccounts.map((x) => x.id).reverse();
    const before = await readWorkspace();
    await b.reorderAccounts(order);
    const after = await readWorkspace();
    for (const id of order)
      expect(after.records[id]?.changed).toBe(before.records[id]?.changed);
    if (sortedFirst) {
      await b.syncNow();
      aDevice.install();
      await a.syncNow();
    } else {
      aDevice.install();
      await a.syncNow();
      bDevice.install();
      await b.syncNow();
    }
    aDevice.install();
    await a.syncNow();
    bDevice.install();
    await b.syncNow();
    expect(a.accounts.find((x) => x.label === "alice")?.secret).toBe(
      replacementSecret,
    );
    expect(b.accounts.find((x) => x.label === "alice")?.secret).toBe(
      replacementSecret,
    );
    expect(b.sortedAccounts.map((x) => x.id)).toEqual(order);
    expect(a.syncStatus).toBe("ready");
    expect(b.syncStatus).toBe("ready");
  },
);

test("sync timestamp ties choose the same account content regardless of local position", async () => {
  const { identify, mergeRecords, validateCredential } =
    await import("../src/domain/records");
  const item = await identify(
    validateCredential({
      provider: "Example",
      login: "alice",
      secret: original.secret,
    }),
  );
  const favorite = { ...item, changed: 100, favorite: true, position: 0 };
  for (const position of [0, 4]) {
    const unfavored = { ...item, changed: 100, favorite: false, position };
    for (const [local, remote] of [
      [favorite, unfavored],
      [unfavored, favorite],
    ]) {
      expect(
        mergeRecords({ [item.id]: local! }, { [item.id]: remote! })[item.id]
          ?.favorite,
      ).toBe(true);
    }
  }
});
