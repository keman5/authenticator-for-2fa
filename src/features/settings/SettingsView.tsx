import { openShortcutSettings, shortcutsPage } from "../../platform/browser";
import { LOCK_DURATIONS } from "../../domain/locking";
import { translate as workspaceCopy } from "../../domain/workspaceCopy";
import { needsFilePickerWindow, openAppWindow } from "../../platform/windows";
import { requestInputMenuAccess } from "../../platform/inputMenu";
import { useState } from "react";
import { useCopy, useVault } from "../../app/vault";
import {
  Confirm,
  ErrorMessage,
  Header,
  Password,
  Select,
  Segmented,
  Switch,
} from "../../shared/ui/controls";
import { LANGUAGES, detectBrowserLanguage } from "../../lib/i18n/languages";
import { loadPasskeyRecord, removePasskey } from "../../platform/passkey";
import { getErrorMessage } from "../../domain/feedback";
import type { AppSettings } from "../../domain/view";
import packageJson from "../../../package.json";

import { TimeCalibration } from "./TimeCalibration";

type SettingsPage = "settings" | "password" | "passkey" | "sync";
export function SettingsView({
  onNavigate,
}: {
  onNavigate: (page: SettingsPage) => void;
}) {
  const vault = useVault(),
    { ui, tr } = useCopy();
  const settings = vault.settings;
  const extra = (key: Parameters<typeof workspaceCopy>[1]) =>
    workspaceCopy(settings.language, key);
  function update(patch: Partial<AppSettings>) {
    void vault.updateSettings(patch).catch((error) => {
      vault.error = getErrorMessage(error, tr("settingsSaveFailed"));
    });
  }
  const id = typeof chrome !== "undefined" ? chrome.runtime?.id : undefined;
  return (
    <>
      <div className="row-title">
        <h2>{ui("settingsTitle")}</h2>
      </div>
      <div className="section-label">{ui("generalSec")}</div>
      <div className="list-card">
        <div className="list-row">
          <span className="tx">
            <b>{ui("langName")}</b>
          </span>
          <Select
            label={ui("langName")}
            value={
              settings.languageMode === "system" ? "auto" : settings.language
            }
            options={[
              { value: "auto", label: ui("langAuto") },
              ...LANGUAGES.map(({ code, label }) => ({ value: code, label })),
            ]}
            onChange={(language) =>
              update({
                language:
                  language === "auto" ? detectBrowserLanguage() : language,
                languageMode: language === "auto" ? "system" : "manual",
              })
            }
          />
        </div>
        <div className="list-row">
          <span className="tx">
            <b>{ui("appearance")}</b>
          </span>
          <Segmented
            label={ui("appearance")}
            value={settings.theme}
            options={(["system", "light", "dark"] as const).map((value) => ({
              value,
              label: tr(value),
            }))}
            onChange={(theme) =>
              update({ theme: theme as AppSettings["theme"] })
            }
          />
        </div>
      </div>
      <div className="list-card" style={{ marginTop: 12 }}>
        <TimeCalibration />
      </div>
      <div className="section-label">{ui("behaviorSec")}</div>
      <div className="list-card">
        <Switch
          label={ui("hideName")}
          hint={ui("hideDesc")}
          checked={settings.hideCodes}
          onChange={(hideCodes) => update({ hideCodes })}
        />
        <Switch
          label={ui("secondsName")}
          hint={ui("secondsDesc")}
          checked={settings.showCountdownSeconds}
          onChange={(showCountdownSeconds) => update({ showCountdownSeconds })}
        />
        <Switch
          label={ui("autofillName")}
          hint={ui("autofillDesc")}
          checked={settings.autoPasteCodes}
          onChange={(autoPasteCodes) => update({ autoPasteCodes })}
        />
        <Switch
          label={ui("priorityName")}
          hint={ui("priorityDesc")}
          checked={settings.accountSortMode === "contextual"}
          onChange={(enabled) =>
            update({ accountSortMode: enabled ? "contextual" : "manual" })
          }
        />
        <Switch
          label={ui("foldName")}
          hint={ui("foldDesc")}
          checked={!settings.alwaysShowAllCodes}
          onChange={(fold) => update({ alwaysShowAllCodes: !fold })}
        />
        <Switch
          label={ui("enhanceName")}
          hint={ui("enhanceDesc")}
          checked={settings.enhancedInputMenu === true}
          onChange={(enhancedInputMenu) => {
            if (!enhancedInputMenu) update({ enhancedInputMenu: false });
            else
              void requestInputMenuAccess()
                .then((allowed) => {
                  if (allowed) update({ enhancedInputMenu: true });
                })
                .catch((error) => {
                  vault.error = getErrorMessage(
                    error,
                    tr("settingsSaveFailed"),
                  );
                });
          }}
        />
      </div>
      <div className="section-label">{ui("securitySec")}</div>
      <div className="list-card">
        <button
          className="list-row"
          type="button"
          onClick={() => onNavigate("password")}
        >
          <span className="tx">
            <b>{ui("pwdName")}</b>
            <small>
              {tr(
                vault.passwordProtected
                  ? "protectionOnHint"
                  : "protectionOffHint",
              )}
            </small>
          </span>
          <span
            className={`status-chip ${vault.passwordProtected ? "" : "off"}`}
          >
            {ui(vault.passwordProtected ? "chipOn" : "chipOff")}
          </span>
          <span className="chev">›</span>
        </button>
        <button
          className="list-row"
          type="button"
          onClick={() => {
            // Firefox closes toolbar panels when native authorization gains focus.
            if (needsFilePickerWindow())
              void openAppWindow("passkey").catch((error) => {
                vault.error = getErrorMessage(error, tr("opensInNewWindow"));
              });
            else onNavigate("passkey");
          }}
        >
          <span className="tx">
            <b>{ui("passkeyName")}</b>
            <small>{ui("passkeyDesc")}</small>
          </span>
          <span className={`status-chip ${loadPasskeyRecord() ? "" : "off"}`}>
            {ui(loadPasskeyRecord() ? "chipOn" : "chipOff")}
          </span>
          <span className="chev">›</span>
        </button>
        <button
          className="list-row"
          type="button"
          onClick={() => onNavigate("sync")}
        >
          <span className="tx">
            <b>{ui("syncName")}</b>
            <small>{tr("syncFeatureBrowser")}</small>
          </span>
          <span className={`status-chip ${vault.syncEnabled ? "" : "off"}`}>
            {ui(vault.syncEnabled ? "chipOn" : "chipOff")}
          </span>
          <span className="chev">›</span>
        </button>
        <div className="list-row">
          <span className="tx">
            <b>{ui("autolockName")}</b>
            <small>{ui("autolockDesc")}</small>
          </span>
          <Select
            label={ui("autolockName")}
            value={String(settings.autoLockMinutes ?? 5)}
            options={LOCK_DURATIONS.map((seconds) => ({
              value: String(seconds < 0 ? -1 : seconds / 60),
              group:
                seconds <= 0
                  ? undefined
                  : extra(
                      seconds < 60
                        ? "unitSeconds"
                        : seconds < 3600
                          ? "unitMinutes"
                          : seconds < 86400
                            ? "unitHours"
                            : "unitDays",
                    ),
              label:
                seconds === 0
                  ? ui("immediate")
                  : seconds === -1
                    ? ui("never")
                    : seconds < 60
                      ? `${seconds} ${extra("unitSeconds")}`
                      : seconds < 3600
                        ? ui("minutesN", { n: seconds / 60 })
                        : seconds < 86400
                          ? `${seconds / 3600} ${extra("unitHours")}`
                          : `${seconds / 86400} ${extra("unitDays")}`,
            }))}
            onChange={(value) => update({ autoLockMinutes: Number(value) })}
          />
        </div>
      </div>
      <div className="section-label">{ui("aboutSec")}</div>
      <div className="list-card">
        <div className="list-row">
          <span className="tx">
            <b>Authenticator - 2FA</b>
            <small>{packageJson.version}</small>
          </span>
        </div>
        <div className="list-row">
          <span className="tx">
            <b>{ui("extIdName")}</b>
            <small>{id ?? ui("extIdNone")}</small>
          </span>
          {id && (
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                void navigator.clipboard
                  .writeText(id)
                  .then(() => vault.showNotice(tr("copied")))
                  .catch(() => {
                    vault.error = tr("copyFailed");
                  });
              }}
            >
              {ui("copy")}
            </button>
          )}
        </div>
        <a
          className="list-row"
          href="https://github.com/keman5/authenticator-for-2fa"
          target="_blank"
          rel="noreferrer"
        >
          <span className="tx">
            <b>{tr("sourceCode")}</b>
          </span>
          <span className="chev">↗</span>
        </a>
      </div>
    </>
  );
}
export function PasswordView({ onBack }: { onBack: () => void }) {
  const vault = useVault(),
    { ui, tr } = useCopy();
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [error, setError] = useState(""),
    [removing, setRemoving] = useState(false);
  async function save() {
    setError("");
    if (password !== confirm) {
      setError(tr("passwordMismatch"));
      return;
    }
    await vault.changePassword(current, password);
    if (vault.error) {
      setError(vault.error);
      vault.error = "";
    } else {
      setCurrent("");
      setPassword("");
      setConfirm("");
      onBack();
    }
  }
  return (
    <>
      <Header title={ui("pwdName")} onBack={onBack} />
      <p className="desc" style={{ marginBottom: 12 }}>
        {tr(vault.passwordProtected ? "protectionOnHint" : "protectionOffHint")}
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {vault.passwordProtected && (
          <Password
            label={tr("currentPassword")}
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
          />
        )}
        <Password
          label={tr("newPassword")}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        <Password
          label={tr("confirmPassword")}
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
        />
        <p className="desc" style={{ marginBottom: 12 }}>
          {tr("passwordHint")}
        </p>
        <div className="btn-row">
          <button
            className="btn btn-primary"
            type="submit"
            disabled={vault.busy || password.length < 1}
          >
            {ui("savePwd")}
          </button>
          {vault.passwordProtected && (
            <button
              className="btn btn-danger-soft"
              type="button"
              disabled={vault.busy || vault.syncEnabled}
              onClick={() => {
                setError("");
                setRemoving(true);
              }}
            >
              {ui("removePwd")}
            </button>
          )}
        </div>
      </form>
      {vault.syncEnabled && <p className="desc">{tr("syncProtectionHint")}</p>}
      {!removing && <ErrorMessage>{error}</ErrorMessage>}
      {removing && (
        <Confirm
          title={ui("removePwd")}
          busy={vault.busy}
          onCancel={() => setRemoving(false)}
          onConfirm={() => {
            void vault.removePassword(current).then(() => {
              if (!vault.error) {
                setRemoving(false);
                setCurrent("");
                onBack();
              }
            });
          }}
        >
          <Password
            label={tr("currentPassword")}
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
          />
        </Confirm>
      )}
    </>
  );
}
export function PasskeyView({
  onBack,
  onProtect,
}: {
  onBack: () => void;
  onProtect: () => void;
}) {
  const vault = useVault(),
    { ui, tr } = useCopy();
  const extra = (key: Parameters<typeof workspaceCopy>[1]) =>
    workspaceCopy(vault.settings.language, key);
  const [registered, setRegistered] = useState(Boolean(loadPasskeyRecord())),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [removing, setRemoving] = useState(false);
  async function register() {
    setBusy(true);
    setError("");
    try {
      await vault.registerPasskey();
      setRegistered(true);
      vault.showNotice(ui("pkRegistered"));
    } catch (error) {
      setError(getErrorMessage(error, ui("passkeyUnavailable")));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Header title={ui("passkeyName")} onBack={onBack} />
      <div className="section-label">{ui("passkeySec")}</div>
      <div className="list-card">
        <div className="list-row">
          <span className="tx">
            <b>{ui(registered ? "pkRegistered" : "pkNone")}</b>
            <small>
              {vault.passwordProtected
                ? ui("passkeySecureHint")
                : tr("syncProtectionTitle")}
            </small>
          </span>
          {(registered || vault.passwordProtected) && (
            <button
              className={registered ? "btn btn-danger-soft" : "btn btn-ghost"}
              type="button"
              disabled={busy}
              onClick={() => (registered ? setRemoving(true) : void register())}
            >
              {registered ? tr("delete") : ui("register")}
            </button>
          )}
        </div>
      </div>
      {vault.passwordProtected && registered && (
        <div className="list-card" style={{ marginTop: 12 }}>
          <Switch
            label={tr("passkeyDefault")}
            hint={tr("passkeyDefaultHint")}
            checked={vault.settings.passkeyDefault === true}
            onChange={(passkeyDefault) => {
              void vault.updateSettings({ passkeyDefault }).catch((error) => {
                setError(getErrorMessage(error, tr("settingsSaveFailed")));
              });
            }}
          />
        </div>
      )}
      {!vault.passwordProtected && (
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" type="button" onClick={onProtect}>
            {tr("setPassword")}
          </button>
        </div>
      )}
      {removing && (
        <Confirm
          title={tr("passkeyDeleteConfirm")}
          onCancel={() => setRemoving(false)}
          onConfirm={() => {
            removePasskey();
            setRegistered(Boolean(loadPasskeyRecord()));
            setRemoving(false);
          }}
        />
      )}
      <ErrorMessage>{error}</ErrorMessage>
      <div className="section-label">{ui("shortcutsSec")}</div>
      <div className="list-card">
        <div className="list-row shortcut-row">
          <span className="tx">
            <b>{ui("openWindow")}</b>
            <small>{ui("shortcutsNote")}</small>
          </span>
          <span className="row-val">
            {/Mac/i.test(navigator.platform) ? "⌘⇧2" : "Ctrl+Shift+2"}
          </span>
        </div>
      </div>
      {typeof chrome !== "undefined" &&
        typeof chrome.runtime?.getURL === "function" &&
        typeof chrome.tabs?.create === "function" &&
        shortcutsPage(chrome.runtime.getURL(""), navigator.userAgent) && (
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button
              className="btn btn-soft"
              type="button"
              onClick={() => {
                void openShortcutSettings().catch((error) =>
                  setError(getErrorMessage(error)),
                );
              }}
            >
              {extra("shortcutSettings")}
            </button>
          </div>
        )}
    </>
  );
}
