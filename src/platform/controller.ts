import {
  activeRecords,
  emptyWorkspace,
  identify,
  insertRecords,
  nextChange,
  reviseRecord,
  type Workspace,
} from "../domain/records";
import { cacheIsOpen, panelExpired, LOCK_DURATIONS } from "../domain/locking";
import { codeFor } from "../domain/otp";
import { newGate, checkGate } from "../domain/sealing";
import { parseTransfer } from "../domain/transfer";
import {
  toAccount,
  toCredential,
  createDefaultAppSettings,
  type AccountDraft,
  type AuthenticatorAccount,
  type AppSettings,
  type OtpCode,
  type ImportResult,
} from "../domain/view";
import { readWorkspace, subscribeWorkspace, transaction } from "./repository";
import { otpTime } from "./time";
import { readBackupAccounts } from "../domain/portable";
import {
  connect,
  synchronize,
  syncSupported,
  syncNamespace,
  deleteSyncGroup,
  type BrowserSyncErrorCode,
} from "./sync";
import { getErrorMessage, AccountChangedError } from "../domain/feedback";
import { touchID, touchIDWindow, TouchIDError } from "./touchID";
import { translate } from "../domain/workspaceCopy";
import {
  enrollPasskey,
  loadPasskeyRecord,
  readPasskeyKey,
  removePasskey,
  requestPasskeyAccess,
} from "./passkey";
import { clearVaultSessionKey, renewPanelLease } from "./session";
import { needsFilePickerWindow, openAppWindow } from "./windows";
import { detectBrowserLanguage } from "../lib/i18n/languages";
import { t } from "../lib/i18n/messages";

type SyncStatus = "off" | "ready" | "syncing" | "pending" | "error";
const initialState = () => ({
  initialized: false,
  hasVault: false,
  locked: true,
  passwordProtected: false,
  busy: false,
  locking: false,
  accounts: [] as AuthenticatorAccount[],
  settings: createDefaultAppSettings(),
  codes: {} as Record<string, OtpCode>,
  notice: "",
  noticeKey: undefined as string | undefined,
  noticeLanguage: undefined as string | undefined,
  error: "",
  syncStatus: "off" as SyncStatus,
  syncError: null as BrowserSyncErrorCode | "" | null,
});
export class AuthenticatorVault {
  private state = initialState();
  private listeners = new Set<() => void>();
  private revision = 0;
  private space = emptyWorkspace();
  private epoch = 0;
  private watching = false;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  declare initialized: boolean;
  declare hasVault: boolean;
  declare locked: boolean;
  declare passwordProtected: boolean;
  declare busy: boolean;
  declare locking: boolean;
  declare accounts: AuthenticatorAccount[];
  declare settings: AppSettings;
  declare codes: Record<string, OtpCode>;
  declare notice: string;
  declare noticeKey: string | undefined;
  declare noticeLanguage: string | undefined;
  declare error: string;
  declare syncStatus: SyncStatus;
  declare syncError: BrowserSyncErrorCode | "" | null;
  constructor() {
    for (const name of Object.keys(this.state) as (keyof typeof this.state)[])
      Object.defineProperty(this, name, {
        get: () => this.state[name],
        set: (value: never) => {
          if (this.state[name] === value) return;
          this.state[name] = value;
          this.notify();
        },
      });
  }
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };
  getSnapshot = () => this.revision;
  private notify() {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
  get sortedAccounts() {
    return [...this.accounts].sort(
      (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
  }
  get syncAvailable() {
    return syncSupported();
  }
  get syncEnabled() {
    return !this.locked && Boolean(this.space.connection);
  }
  get syncRecoveryKey() {
    return this.syncEnabled ? (this.space.connection?.key ?? "") : "";
  }
  private accept(workspace: Workspace, preserve = true) {
    const wasProtected = this.passwordProtected;
    const sameProof = workspace.gate?.proof === this.space.gate?.proof;
    const manualLock = workspace.gate?.lockedAt !== this.space.gate?.lockedAt;
    this.space = workspace;
    this.passwordProtected = Boolean(workspace.gate);
    if (!workspace.gate) this.locked = false;
    else if (!preserve || !sameProof || !wasProtected)
      this.locked = !cacheIsOpen(workspace.gate);
    else if (
      !this.locked &&
      panelExpired(workspace.gate, workspace.gate.unlockedAt)
    )
      this.locked = true;
    if (preserve && (manualLock || !sameProof)) {
      this.epoch++;
      if (workspace.gate) this.locked = true;
    }
    const p = workspace.preferences;
    this.settings = {
      language:
        p.languageMode === "system" ? detectBrowserLanguage() : p.locale,
      languageMode: p.languageMode ?? "manual",
      theme: p.theme,
      hideCodes: p.conceal,
      showCountdownSeconds: p.seconds,
      autoPasteCodes: p.paste,
      alwaysShowAllCodes: p.showAll ?? false,
      accountSortMode: p.sortMode ?? "contextual",
      autoLockMinutes: workspace.gate
        ? (workspace.gate.lockAfter ?? 0) < 0
          ? -1
          : (workspace.gate.lockAfter ?? 0) / 60
        : 0,
      enhancedInputMenu: p.inputMenu ?? false,
      passkeyDefault: p.passkeyDefault ?? false,
      lastBackupAt: p.lastBackupAt,
    };
    this.accounts = this.locked ? [] : activeRecords(workspace).map(toAccount);
    if (this.locked) this.codes = {};
    this.hasVault = true;
    this.initialized = true;
  }
  async initialize() {
    const previous = JSON.stringify([
      this.space.records,
      this.space.connection,
    ]);
    const epoch = this.epoch;
    const workspace = await readWorkspace();
    if (epoch !== this.epoch) return;
    this.accept(workspace, this.initialized);
    await this.refreshCodes();
    if (
      this.syncEnabled &&
      previous !== JSON.stringify([this.space.records, this.space.connection])
    )
      this.scheduleSync();
  }
  private requireOpen() {
    if (this.locked) throw new Error("Unlock before changing accounts.");
  }
  private async write<T>(
    change: (workspace: Workspace) => T | Promise<T>,
    sync = true,
  ) {
    this.requireOpen();
    const epoch = this.epoch;
    const value = await transaction(async (workspace) => {
      if (
        epoch !== this.epoch ||
        this.locked ||
        workspace.gate?.proof !== this.space.gate?.proof ||
        workspace.gate?.lockedAt !== this.space.gate?.lockedAt ||
        panelExpired(workspace.gate, workspace.gate?.unlockedAt)
      )
        throw new Error("Unlock before changing accounts.");
      const result = await change(workspace);
      if (
        epoch !== this.epoch ||
        this.locked ||
        panelExpired(workspace.gate, workspace.gate?.unlockedAt)
      )
        throw new Error("Unlock before changing accounts.");
      return result;
    });
    if (epoch === this.epoch) {
      this.accept(value.workspace);
      await this.refreshCodes();
      if (sync) this.scheduleSync();
    }
    return value.result;
  }
  async refreshCodes() {
    if (this.locked) return;
    const stamp = this.space.gate?.unlockedAt;
    if (panelExpired(this.space.gate, stamp)) {
      await this.lock();
      return;
    }
    const duration = this.space.gate?.lockAfter ?? 0;
    await renewPanelLease(
      this.space,
      duration > 0 && stamp !== undefined ? stamp + duration * 1000 : undefined,
    );
    const epoch = this.epoch,
      accounts = this.accounts,
      now = await otpTime();
    const values = await Promise.all(
      accounts.map(async (account) => {
        const seconds = Math.floor(now / 1000);
        const nextBoundary =
          (Math.floor(seconds / account.period) + 1) * account.period;
        const remaining = account.type === "hotp" ? 0 : nextBoundary - seconds;
        return [
          account.id,
          {
            accountId: account.id,
            value: await codeFor(toCredential(account), now),
            remaining,
            progress: account.type === "hotp" ? 0 : remaining / account.period,
          },
        ] as const;
      }),
    );
    if (epoch === this.epoch && !this.locked && accounts === this.accounts)
      this.codes = Object.fromEntries(values);
  }
  async addAccount(draft: AccountDraft) {
    const item = await identify(toCredential(draft));
    return this.write((space) => {
      const result = insertRecords(space, [item]);
      if (result.skipped) throw new Error("This account already exists.");
      return toAccount(space.records[item.id]!);
    });
  }
  private referenced(
    space: Workspace,
    reference: AuthenticatorAccount | string,
  ) {
    const value =
      space.records[typeof reference === "string" ? reference : reference.id];
    if (
      !value ||
      value.removed ||
      (typeof reference !== "string" &&
        new Date(value.changed || 0).toISOString() !== reference.updatedAt)
    )
      throw new AccountChangedError();
    return value;
  }
  async updateAccount(
    reference: AuthenticatorAccount | string,
    patch: Partial<AccountDraft>,
  ) {
    await this.write((space) => {
      const old = this.referenced(space, reference);
      const draft = { ...toAccount(old), ...patch };
      const value = toCredential(draft, old);
      reviseRecord(space, old, value);
      return toAccount(space.records[old.id]!);
    });
  }
  async deleteAccount(reference: AuthenticatorAccount | string) {
    await this.write((space) => {
      const old = this.referenced(space, reference);
      space.records[old.id] = {
        ...old,
        removed: true,
        changed: nextChange(old.changed),
      };
    });
  }
  async advanceHotp(reference: AuthenticatorAccount | string) {
    return this.write((space) => {
      const old = this.referenced(space, reference);
      if (old.mode !== "hotp") return;
      if (!Number.isSafeInteger(old.counter + 1))
        throw new Error("Invalid counter.");
      space.records[old.id] = {
        ...old,
        counter: old.counter + 1,
        changed: nextChange(old.changed),
      };
    });
  }
  async reorderAccounts(ids: string[]) {
    await this.write((space) => {
      const current = activeRecords(space);
      if (
        ids.length !== current.length ||
        new Set(ids).size !== current.length ||
        ids.some((id) => !space.records[id] || space.records[id]!.removed)
      )
        throw new AccountChangedError();
      ids.forEach((id, position) => {
        const item = space.records[id]!;
        space.records[id] = {
          ...item,
          position,
        };
      });
    });
  }
  async importText(text: string): Promise<ImportResult> {
    const incoming = await parseTransfer(text);
    const result = await this.write((space) => insertRecords(space, incoming));
    return {
      imported: result.added,
      skipped: result.skipped,
      errors: [],
      accounts: this.accounts,
    };
  }
  async importEncryptedBackupText(text: string, password: string) {
    try {
      return await this.importText(
        JSON.stringify({
          app: "2fa-authenticator",
          version: 1,
          accounts: await readBackupAccounts(text, password),
        }),
      );
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "password"
      )
        throw new Error("Backup password is incorrect.");
      throw error;
    }
  }
  async updateSettings(patch: Partial<AppSettings>) {
    await this.write((space) => {
      const p = space.preferences;
      if (patch.language !== undefined) p.locale = patch.language;
      if (patch.languageMode !== undefined) p.languageMode = patch.languageMode;
      if (patch.theme !== undefined) p.theme = patch.theme;
      if (patch.hideCodes !== undefined) p.conceal = patch.hideCodes;
      if (patch.showCountdownSeconds !== undefined)
        p.seconds = patch.showCountdownSeconds;
      if (patch.autoPasteCodes !== undefined) p.paste = patch.autoPasteCodes;
      if (patch.accountSortMode !== undefined)
        p.sortMode = patch.accountSortMode;
      if (patch.alwaysShowAllCodes !== undefined)
        p.showAll = patch.alwaysShowAllCodes;
      if (patch.enhancedInputMenu !== undefined)
        p.inputMenu = patch.enhancedInputMenu;
      if (patch.passkeyDefault !== undefined)
        p.passkeyDefault = patch.passkeyDefault;
      if ("lastBackupAt" in patch) p.lastBackupAt = patch.lastBackupAt;
      if (space.gate && patch.autoLockMinutes !== undefined) {
        const seconds =
          patch.autoLockMinutes < 0 ? -1 : patch.autoLockMinutes * 60;
        if (!LOCK_DURATIONS.includes(seconds))
          throw new Error("Invalid lock duration.");
        space.gate.lockAfter = seconds;
      }
    });
  }
  async changePassword(current: string, password: string) {
    const epoch = this.epoch;
    this.error = "";
    try {
      await this.write(async (space) => {
        if (space.gate && !(await checkGate(space.gate, current)))
          throw new Error("Incorrect password.");
        space.gate = {
          ...(await newGate(password)),
          lockAfter: space.gate?.lockAfter ?? 0,
          unlockedAt: Date.now(),
        };
      });
      if (this.epoch !== epoch + 1) return;
      this.locked = false;
      removePasskey();
      this.accept(this.space);
      await this.refreshCodes();
    } catch (error) {
      this.error =
        error instanceof Error && error.message === "Incorrect password."
          ? t(this.settings.language, "passwordIncorrect")
          : getErrorMessage(error);
    }
  }
  async removePassword(password: string) {
    this.error = "";
    try {
      await this.write(async (space) => {
        if (space.connection)
          throw new Error(
            "Turn off Browser Sync before removing password protection.",
          );
        if (space.gate && !(await checkGate(space.gate, password)))
          throw new Error("Incorrect password.");
        delete space.gate;
      });
      removePasskey();
    } catch (error) {
      this.error =
        error instanceof Error && error.message === "Incorrect password."
          ? t(this.settings.language, "passwordIncorrect")
          : getErrorMessage(error);
    }
  }
  private async publishUnlocked(workspace: Workspace, epoch: number) {
    if (epoch !== this.epoch) return;
    this.accept(workspace, false);
    this.locked = false;
    this.accounts = activeRecords(workspace).map(toAccount);
    await this.refreshCodes();
    this.scheduleSync();
  }
  async unlock(password: string) {
    const epoch = ++this.epoch;
    this.busy = true;
    this.error = "";
    try {
      const result = await transaction(async (space) => {
        if (space.gate && !(await checkGate(space.gate, password)))
          throw new Error("Incorrect password.");
        if (epoch !== this.epoch) throw new AccountChangedError();
        if (space.gate) space.gate.unlockedAt = Date.now();
      });
      await this.publishUnlocked(result.workspace, epoch);
    } catch {
      if (epoch === this.epoch)
        this.error = t(this.settings.language, "passwordIncorrect");
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  async lock() {
    if (this.locking) return;
    this.locking = true;
    try {
      this.epoch++;
      this.busy = false;
      this.locked = this.passwordProtected;
      this.accounts = [];
      this.codes = {};
      await clearVaultSessionKey();
      if (!this.passwordProtected) return;
      await transaction((space) => {
        if (space.gate) {
          delete space.gate.unlockedAt;
          space.gate.lockedAt = nextChange(space.gate.lockedAt);
        }
      });
    } finally {
      this.locking = false;
    }
  }
  async recordActivity() {
    /* Screen-lock deadlines advance only after successful authentication. */
  }
  async checkAutoLock() {
    const workspace = await readWorkspace();
    if (!workspace.gate) return;
    if (!this.locked && panelExpired(workspace.gate, workspace.gate.unlockedAt))
      await this.lock();
    else if (workspace.gate.proof !== this.space.gate?.proof)
      await this.initialize();
  }
  get touchIDEnabled() {
    return this.space.gate?.touchID === true;
  }
  async configureTouchID() {
    this.requireOpen();
    if (!this.space.gate) throw new Error("Set a password first.");
    if (this.touchIDEnabled) {
      await this.write((space) => {
        if (space.gate) space.gate.touchID = false;
      });
      return;
    }
    if (await touchIDWindow(true)) return;
    const proof = this.space.gate.proof;
    await touchID(
      "authenticate",
      translate(this.settings.language, "touchIDReason"),
    );
    await this.write((space) => {
      if (space.gate?.proof !== proof) throw new AccountChangedError();
      space.gate!.touchID = true;
    });
  }
  async unlockTouchID() {
    const epoch = ++this.epoch;
    this.error = "";
    this.busy = true;
    try {
      if (await touchIDWindow()) return;
      const workspace = await readWorkspace();
      if (!workspace.gate?.touchID) throw new Error("Set up Touch ID first.");
      await touchID(
        "authenticate",
        translate(this.settings.language, "touchIDReason"),
      );
      const saved = await transaction((space) => {
        if (
          epoch !== this.epoch ||
          !space.gate?.touchID ||
          space.gate.proof !== workspace.gate!.proof ||
          space.gate.lockedAt !== workspace.gate!.lockedAt
        )
          throw new AccountChangedError();
        space.gate.unlockedAt = Date.now();
      });
      await this.publishUnlocked(saved.workspace, epoch);
    } catch (error) {
      if (epoch === this.epoch)
        this.error =
          error instanceof TouchIDError
            ? translate(this.settings.language, `error_touchID_${error.code}`)
            : getErrorMessage(error);
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  get passkeyRegistered() {
    return Boolean(
      this.space.gate &&
      loadPasskeyRecord()?.fingerprint === this.space.gate.proof,
    );
  }
  async registerPasskey() {
    this.requireOpen();
    if (!this.space.gate) throw new Error("Set a password first.");
    const proof = this.space.gate.proof;
    const rpId = await requestPasskeyAccess();
    await enrollPasskey(
      crypto.getRandomValues(new Uint8Array(32)).buffer,
      proof,
      rpId,
      this.settings.language,
    );
  }
  async unlockPasskey() {
    if (this.busy || this.locking) return;
    const epoch = ++this.epoch;
    this.busy = true;
    this.error = "";
    try {
      if (needsFilePickerWindow()) {
        await openAppWindow("unlock-passkey");
        return;
      }
      const workspace = await readWorkspace();
      if (!workspace.gate) throw new Error("Set a password first.");
      const value = await readPasskeyKey(workspace.gate.proof);
      if (value.byteLength !== 32) throw new Error("Invalid passkey.");
      const saved = await transaction((space) => {
        if (
          epoch !== this.epoch ||
          space.gate?.proof !== workspace.gate?.proof ||
          space.gate?.lockedAt !== workspace.gate?.lockedAt
        )
          throw new AccountChangedError();
        space.gate!.unlockedAt = Date.now();
      });
      await this.publishUnlocked(saved.workspace, epoch);
    } catch (error) {
      if (epoch === this.epoch) this.error = getErrorMessage(error);
    } finally {
      if (epoch === this.epoch) this.busy = false;
    }
  }
  async resetVault() {
    const language = this.settings.language;
    this.error = "";
    this.clearNotice();
    await this.write((space) => {
      Object.assign(space, emptyWorkspace());
      delete space.gate;
      delete space.connection;
    });
    removePasskey();
    this.showNotice(t(language, "noticeDataCleared"), language);
  }
  showNotice(message: string, language?: string) {
    this.noticeLanguage = language;
    this.notice = message;
    this.noticeKey = undefined;
  }
  clearNotice() {
    this.notice = "";
    this.noticeKey = undefined;
    this.noticeLanguage = undefined;
  }
  async startBrowserSync(key: string, join: boolean) {
    if (!this.passwordProtected) {
      this.syncError = "passwordRequired";
      return;
    }
    await this.runSync(async (space) => connect(space, key, join));
  }
  async syncNow() {
    await this.runSync((space) => synchronize(space));
  }
  private async runSync(action: (space: Workspace) => Promise<void>) {
    this.syncStatus = "syncing";
    this.syncError = null;
    try {
      await this.write(action, false);
      this.syncStatus = this.space.connection ? "ready" : "off";
    } catch (error) {
      this.syncStatus = "error";
      this.syncError = /quota|MAX_/i.test(getErrorMessage(error))
        ? "quota"
        : error && typeof error === "object" && "code" in error
          ? error.code === "quota"
            ? "quota"
            : error.code === "missingGroup"
              ? "notFound"
              : "storage"
          : "storage";
    }
  }
  async stopBrowserSync() {
    await this.write((space) => {
      delete space.connection;
    });
    this.syncStatus = "off";
  }
  async deleteBrowserSync() {
    await this.write((space) => deleteSyncGroup(space));
    this.syncStatus = "off";
  }
  private scheduleSync() {
    if (!this.watching || !this.syncEnabled) return;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = undefined;
      if (this.syncEnabled) void this.syncNow();
    }, 300);
  }
  watchStorage() {
    this.watching = true;
    const stop = subscribeWorkspace(() => {
      void this.initialize().catch((error) => {
        this.error = getErrorMessage(error);
      });
    });
    const remote = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (
        area === "sync" &&
        this.space.connection &&
        Object.keys(changes).some((key) =>
          key.startsWith(syncNamespace(this.space.connection!.group)),
        )
      )
        this.scheduleSync();
    };
    if (typeof chrome !== "undefined")
      chrome.storage?.onChanged?.addListener(remote);
    this.scheduleSync();
    return () => {
      this.watching = false;
      clearTimeout(this.syncTimer);
      stop();
      if (typeof chrome !== "undefined")
        chrome.storage?.onChanged?.removeListener(remote);
    };
  }
}
export const authenticatorVault = new AuthenticatorVault();
