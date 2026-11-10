import { afterEach, expect, test, vi } from "vitest";
import {
  activeRecords,
  emptyWorkspace,
  identify,
  insertRecords,
  nextChange,
  validateCredential,
} from "../src/domain/records";
import {
  connect,
  deleteSyncGroup,
  groupFor,
  recoveryKey,
  synchronize,
  syncNamespace,
} from "../src/platform/sync";
import { AuthenticatorVault } from "../src/platform/controller";
import { installMemoryStorage } from "./helpers/storage";
import { createBrowserSyncNetwork } from "./helpers/browserSync";
import { createEncryptedBackupFile } from "../src/domain/portable";
import { encryptedBackup } from "../src/domain/sealing";
import { toCredential } from "../src/domain/view";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const credential = async (login = "alice") =>
  identify(
    validateCredential({
      provider: "Example",
      login,
      secret: "JBSWY3DPEHPK3PXP",
    }),
  );
test("group deletion disconnects stale offline devices and cannot be recreated using the old key", async () => {
  const network = createBrowserSyncNetwork();
  network.createDevice().install();
  const a = emptyWorkspace();
  insertRecords(a, [await credential()]);
  const key = recoveryKey();
  await connect(a, key, false);
  const b = emptyWorkspace();
  await connect(b, key, true);
  const snapshot = structuredClone(b.records);
  await deleteSyncGroup(a);
  expect(a.connection).toBeUndefined();
  expect(activeRecords(a)).toHaveLength(1);
  await synchronize(b);
  expect(b.connection).toBeUndefined();
  expect(b.records).toEqual(snapshot);
  await expect(connect(emptyWorkspace(), key, true)).rejects.toThrow(
    "missingGroup",
  );
  await expect(connect(emptyWorkspace(), key, false)).rejects.toThrow(
    "missingGroup",
  );
  expect(Object.keys(network.cloud)).toEqual([
    syncNamespace(await groupFor(key)) + "hello",
  ]);
});
test("remote record edits preserve each device account order and preferences", async () => {
  const network = createBrowserSyncNetwork();
  network.createDevice().install();
  const a = emptyWorkspace();
  insertRecords(a, [await credential(), await credential("bob")]);
  await connect(a, recoveryKey(), false);
  const b = emptyWorkspace();
  await connect(b, a.connection!.key, true);
  const rows = activeRecords(b);
  b.records[rows[0]!.id]!.position = 2;
  b.records[rows[1]!.id]!.position = 1;
  b.preferences.conceal = true;
  const id = rows[0]!.id;
  a.records[id] = {
    ...a.records[id]!,
    login: "edited",
    changed: nextChange(a.records[id]!.changed),
  };
  await synchronize(a);
  await synchronize(b);
  expect(activeRecords(b).map((x) => x.login)).toEqual(["bob", "edited"]);
  expect(b.preferences.conceal).toBe(true);
  await synchronize(a);
  expect(activeRecords(a).map((x) => x.login)).toEqual(["edited", "bob"]);
});
test("tampered sync records cannot partially replace a local workspace", async () => {
  const network = createBrowserSyncNetwork(),
    device = network.createDevice();
  installMemoryStorage();
  device.install();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.addAccount({ label: "alice", secret: "JBSWY3DPEHPK3PXP" });
  await vault.changePassword("", "1");
  await vault.startBrowserSync(recoveryKey(), false);
  const before = structuredClone(device.local.values);
  const name = Object.keys(network.cloud).find((x) => !x.endsWith(".hello"))!;
  network.cloud[name] = { iv: "!", payload: "!" };
  await vault.syncNow();
  expect(vault.syncStatus).toBe("error");
  expect(device.local.values).toEqual(before);
  expect(vault.accounts).toHaveLength(1);
});
test("screen protection cannot be removed while sync remains connected", async () => {
  const network = createBrowserSyncNetwork();
  installMemoryStorage();
  network.createDevice().install();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.changePassword("", "1");
  await vault.startBrowserSync(recoveryKey(), false);
  await vault.removePassword("1");
  expect(vault.error).not.toBe("");
  expect(vault.passwordProtected).toBe(true);
  await vault.stopBrowserSync();
  await vault.removePassword("1");
  expect(vault.passwordProtected).toBe(false);
});
test("local edits automatically synchronize while the UI subscribes, and stopping removes the timer", async () => {
  installMemoryStorage();
  const network = createBrowserSyncNetwork(),
    device = network.createDevice();
  device.install();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.changePassword("", "1");
  await vault.startBrowserSync(recoveryKey(), false);
  const stop = vault.watchStorage();
  try {
    await vault.addAccount({ label: "automatic", secret: "JBSWY3DPEHPK3PXP" });
    await vi.waitFor(() => expect(Object.keys(network.cloud)).toHaveLength(2));
    const remote = emptyWorkspace();
    await connect(remote, vault.syncRecoveryKey, true);
    expect(activeRecords(remote)[0]?.login).toBe("automatic");
  } finally {
    stop();
  }
  const writes = device.sync.writes;
  await vault.addAccount({ label: "after stop", secret: "JBSWY3DPEHPK3PXP" });
  await new Promise((resolve) => setTimeout(resolve, 350));
  expect(device.sync.writes).toBe(writes);
});

test("reopening and unlocking a connected vault pulls changes made while it was closed", async () => {
  installMemoryStorage();
  const network = createBrowserSyncNetwork();
  network.createDevice().install();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.changePassword("", "1");
  const key = recoveryKey();
  await vault.startBrowserSync(key, false);
  await vault.lock();
  const remote = emptyWorkspace();
  await connect(remote, key, true);
  insertRecords(remote, [await credential("remote update")]);
  await synchronize(remote);

  const reopened = new AuthenticatorVault();
  const stop = reopened.watchStorage();
  try {
    await reopened.initialize();
    expect(reopened.locked).toBe(true);
    await reopened.unlock("1");
    // Unlocking also changes the shared workspace timestamp.
    await reopened.initialize();
    expect(reopened.locked).toBe(false);
    await vi.waitFor(() =>
      expect(reopened.accounts.map((account) => account.label)).toEqual([
        "remote update",
      ]),
    );
  } finally {
    stop();
  }
});

test.each(["encrypted", "json", "legacy encrypted"])(
  "restoring an edited account from a %s backup preserves its sync identity",
  async (format) => {
    installMemoryStorage();
    const network = createBrowserSyncNetwork();
    network.createDevice().install();
    const original = new AuthenticatorVault();
    await original.initialize();
    await original.addAccount({ label: "alice", secret: "JBSWY3DPEHPK3PXP" });
    await original.updateAccount(original.accounts[0]!, {
      label: "alice updated",
    });
    await original.changePassword("", "1");
    const key = recoveryKey();
    await original.startBrowserSync(key, false);
    const text =
      format === "legacy encrypted"
        ? await encryptedBackup(
            {
              records: original.accounts.map((account) =>
                toCredential(account),
              ),
            },
            "backup password",
          )
        : format === "encrypted"
          ? await (
              await createEncryptedBackupFile(
                original.accounts,
                original.settings,
                "backup password",
              )
            ).blob.text()
          : JSON.stringify({
              app: "2fa-authenticator",
              version: 1,
              accounts: original.accounts,
            });

    network.createDevice().install();
    const restored = new AuthenticatorVault();
    await restored.initialize();
    if (format !== "json")
      await restored.importEncryptedBackupText(text, "backup password");
    else await restored.importText(text);
    if (format !== "legacy encrypted")
      expect(restored.accounts[0]!.id).toBe(original.accounts[0]!.id);
    await restored.changePassword("", "1");
    await restored.startBrowserSync(key, true);
    expect(restored.syncStatus).toBe("ready");
    expect(restored.accounts[0]!.id).toBe(original.accounts[0]!.id);
    expect(restored.accounts.map((account) => account.label)).toEqual([
      "alice updated",
    ]);
    const remote = emptyWorkspace();
    await connect(remote, key, true);
    expect(activeRecords(remote)).toHaveLength(1);
  },
);
