import { translate as workspaceCopy } from '../domain/workspaceCopy';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Database,
  KeyRound,
  Lock,
  Plus,
  Search,
  Settings,
  X
} from 'lucide-react';
import { VaultProvider, useCopy, useVault } from './vault';
import {
  authenticatorVault,
  type AuthenticatorVault
} from '../platform/controller';
import { AccountList } from '../features/accounts/AccountList';
import { AccountForm } from '../features/accounts/AccountForm';
import { QrView } from '../features/accounts/QrView';
import { Scanner } from '../features/import-export/Scanner';
import { ImportExportView } from '../features/import-export/ImportExportView';
import {
  PasskeyView,
  PasswordView,
  SettingsView
} from '../features/settings/SettingsView';
import { SyncView } from '../features/sync/SyncView';
import {
  Confirm,
  ErrorMessage,
  Header,
  Logo,
  Password
} from '../shared/ui/controls';
import { getErrorMessage } from '../domain/feedback';
import type { AuthenticatorAccount } from '../domain/view';
import type { PageContext } from '../domain/site';
import {
  getPageWindowId,
  readAppRoute,
  needsCameraWindow,
  openAppWindow
} from '../platform/windows';
import { useAutoLock } from './useAutoLock';
import { Confetti } from '../shared/ui/Confetti';
import { detectBrowserLanguage } from '../lib/i18n/languages';

type View =
  | 'codes'
  | 'data'
  | 'settings'
  | 'password'
  | 'passkey'
  | 'sync'
  | 'add'
  | 'edit'
  | 'qr';
interface RuntimeResponse {
  ok?: boolean;
  error?: string;
  pasted?: boolean;
  pageContext?: unknown;
}
function sendMessage(message: unknown): Promise<RuntimeResponse> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      reject(new Error('This action is available in the installed extension.'));
      return;
    }
    chrome.runtime.sendMessage(
      message,
      (response: RuntimeResponse | undefined) => {
        const error = chrome.runtime.lastError?.message;
        if (error) reject(new Error(error));
        else if (response?.ok === false)
          reject(new Error(response.error || 'The action failed.'));
        else resolve(response ?? {});
      }
    );
  });
}
function parseContext(value: unknown): PageContext | null {
  if (value === null || typeof value !== 'object') return null;
  if (!('hostname' in value) || typeof value.hostname !== 'string') return null;
  const hostname = value.hostname;
  if (hostname.length < 1 || hostname.length > 253) return null;
  const result: PageContext = { hostname };
  if ('faviconReady' in value && value.faviconReady === true)
    result.faviconReady = true;
  if ('title' in value && typeof value.title === 'string')
    result.title = value.title.substring(0, 512);
  return result;
}
export default function App({
  vault = authenticatorVault
}: {
  vault?: AuthenticatorVault;
}) {
  return (
    <VaultProvider vault={vault}>
      <Application />
    </VaultProvider>
  );
}
function Application() {
  const vault = useVault(),
    { ui, tr, feedback } = useCopy();
  const [view, setView] = useState<View>('codes'),
    [celebration, setCelebration] = useState(0),
    [query, setQuery] = useState(''),
    [scannedAccountIds, setScannedAccountIds] = useState<string[]>([]),
    [addMode, setAddMode] = useState<'scan' | 'manual'>('scan'),
    [editing, setEditing] = useState<AuthenticatorAccount | null>(null),
    [deleting, setDeleting] = useState<AuthenticatorAccount | null>(null),
    [qrAccountIds, setQrAccountIds] = useState<string[]>([]),
    [context, setContext] = useState<PageContext | null>(null),
    [contextReady, setContextReady] = useState(false),
    [systemDark, setSystemDark] = useState(
      () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
    );
  const body = useRef<HTMLElement>(null),
    browserWindow = useRef<number | undefined>(undefined),
    contextRequest = useRef(0),
    pendingRoute = useRef(readAppRoute(window.location.href)),
    qrFrom = useRef<View>('codes'),
    celebrationComplete = useRef<(() => void) | undefined>(undefined);
  const qrAccounts = qrAccountIds.flatMap((id) => {
    const account = vault.accounts.find((account) => account.id === id);
    return account ? [account] : [];
  });
  useEffect(() => {
    if (view === 'qr' && qrAccounts.length === 0) {
      setQrAccountIds([]);
      setView(qrFrom.current);
    }
  }, [view, qrAccounts.length]);
  const celebrate = useCallback((onComplete?: () => void) => {
    celebrationComplete.current = onComplete;
    setCelebration((value) => value + 1);
  }, []);
  const finishCelebration = useCallback(() => {
    celebrationComplete.current?.();
    celebrationComplete.current = undefined;
    setCelebration(0);
  }, []);
  const refreshContext = useCallback(async (clear = true) => {
    const current = ++contextRequest.current;
    if (clear) setContext(null);
    try {
      const response = await sendMessage({
        type: 'get-active-page-context',
        windowId: browserWindow.current
      });
      if (current === contextRequest.current)
        setContext(parseContext(response.pageContext));
    } catch {
      /* Active page metadata is optional. */
    }
  }, []);
  useEffect(() => {
    let active = true;
    const stop = vault.watchStorage();
    void (async () => {
      try {
        browserWindow.current = await getPageWindowId();
        await vault.initialize();
        await refreshContext();
      } catch (error) {
        vault.error = getErrorMessage(error, 'Unable to load the vault.');
      } finally {
        if (active) setContextReady(true);
      }
    })();
    const timer = window.setInterval(() => {
      void vault.refreshCodes().catch((error) => {
        vault.error = getErrorMessage(error, 'Unable to refresh codes.');
      });
    }, 1000);
    const listener = (message: unknown) => {
      if (!message || typeof message !== 'object') return;
      const value = message as Record<string, unknown>;
      if (
        value.type === 'active-page-context-changed' &&
        (browserWindow.current === undefined ||
          value.windowId === browserWindow.current)
      )
        void refreshContext(value.clearCurrent !== false);
      if (
        value.type === 'page-scan:completed' &&
        (value.windowId === undefined ||
          value.windowId === browserWindow.current)
      ) {
        if (value.cancelled || value.message === 'Page scan cancelled.') return;
        if (value.ok === true) {
          void vault
            .initialize()
            .then(() => {
              setScannedAccountIds(vault.accounts.map((account) => account.id));
              setQuery('');
              if (typeof value.message === 'string')
                vault.showNotice(value.message);
              if (typeof value.imported === 'number' && value.imported > 0)
                celebrate();
              return refreshContext();
            })
            .catch((error) => {
              vault.error = getErrorMessage(error, 'Page scan failed.');
            });
        }
      }
    };
    if (typeof chrome !== 'undefined')
      chrome.runtime?.onMessage?.addListener(listener);
    return () => {
      active = false;
      window.clearInterval(timer);
      stop();
      if (typeof chrome !== 'undefined')
        chrome.runtime?.onMessage?.removeListener(listener);
    };
  }, [vault, refreshContext, celebrate]);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!media) return;
    const changed = () => setSystemDark(media.matches);
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    document.documentElement.lang = vault.settings.language;
    document.documentElement.dir =
      vault.settings.language === 'ar' ? 'rtl' : 'ltr';
  }, [vault.settings.language]);
  useEffect(() => {
    const changed = () => {
      if (vault.settings.languageMode === 'system')
        void vault
          .updateSettings({
            language: detectBrowserLanguage(),
            languageMode: 'system'
          })
          .catch((error) => {
            vault.error = getErrorMessage(error, tr('settingsSaveFailed'));
          });
    };
    window.addEventListener('languagechange', changed);
    return () => window.removeEventListener('languagechange', changed);
  }, [vault]);
  const theme =
    vault.settings.theme === 'system'
      ? systemDark
        ? 'dark'
        : 'light'
      : vault.settings.theme;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
  }, [theme]);
  const initialUnlock = useRef(true);
  useEffect(() => {
    if (!vault.locked) initialUnlock.current = false;
    if (vault.locked) {
      setCelebration(0);
      setView('codes');
      setEditing(null);
      setDeleting(null);
      setQrAccountIds([]);
      setQuery('');
      setScannedAccountIds([]);
      setContext(null);
    }
  }, [vault.locked]);
  useEffect(() => {
    if (vault.initialized && !vault.hasVault) {
      setView('codes');
      setEditing(null);
      setDeleting(null);
      setQrAccountIds([]);
      setQuery('');
    }
  }, [vault.initialized, vault.hasVault]);
  useEffect(() => {
    if (vault.initialized && !vault.locked && pendingRoute.current) {
      const route = pendingRoute.current;
      pendingRoute.current = null;
      if (
        route === 'add-qr' ||
        route === 'add-screen' ||
        route === 'add-page'
      ) {
        setAddMode('scan');
        setView('add');
      } else
        setView(
          route === 'passkey'
            ? 'passkey'
            : route === 'unlock-passkey'
              ? 'codes'
              : 'data'
        );
    }
  }, [vault.initialized, vault.locked]);
  useEffect(() => {
    if (!vault.notice) return;
    const key = vault.noticeKey;
    const timer = setTimeout(() => {
      if (vault.noticeKey === key) vault.clearNotice();
    }, 2000);
    return () => clearTimeout(timer);
  }, [vault, vault.notice, vault.noticeKey]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.key !== 'Escape' ||
        document.querySelector('[role="dialog"]')
      )
        return;
      if (deleting) {
        setDeleting(null);
        event.preventDefault();
        return;
      }
      if (view !== 'codes') {
        setView(
          view === 'data' ||
            view === 'settings' ||
            view === 'add' ||
            view === 'edit' ||
            view === 'qr'
            ? 'codes'
            : 'settings'
        );
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [view, deleting]);
  useAutoLock(vault);
  function showQr(accounts: AuthenticatorAccount[]) {
    qrFrom.current = view;
    setQrAccountIds(accounts.map((account) => account.id));
    setView('qr');
  }
  async function copy(code: string, fill = false) {
    vault.error = '';
    let pasted = false;
    try {
      await navigator.clipboard.writeText(code);
    } catch (failure) {
      vault.error = getErrorMessage(failure, tr('copyFailed'));
      return;
    }
    if (vault.settings.autoPasteCodes || fill) {
      try {
        const result = await sendMessage({
          type: 'paste-code',
          code,
          windowId: browserWindow.current
        });
        pasted = result.pasted === true;
      } catch {
        // Clipboard success remains useful when the page rejects filling.
      }
    }
    const message = pasted ? 'copiedAndPasted' : 'copied';
    vault.showNotice(tr(message));
  }
  async function pageScan() {
    if (needsCameraWindow()) {
      await openAppWindow('add-page');
      return;
    }
    await sendMessage({
      type: 'start-page-scan',
      windowId: browserWindow.current
    });
  }
  // Follow the next expiring code when accounts use different periods.
  const logoAccount = vault.locked
    ? undefined
    : vault.accounts
        .filter((account) => account.type !== 'hotp' && vault.codes[account.id])
        .sort(
          (a, b) => vault.codes[a.id].remaining - vault.codes[b.id].remaining
        )[0];
  const navView =
    view === 'data' || (view === 'qr' && qrFrom.current === 'data')
      ? 'data'
      : ['settings', 'password', 'passkey', 'sync'].includes(view)
        ? 'settings'
        : 'codes';
  return (
    <div className="pui" id="popup" data-theme={theme} data-view={view}>
      <header className="p-head" inert={vault.locked || undefined}>
        <div className="brand-logo" role="img" aria-label={ui('brandAria')}>
          <Logo
            remaining={
              logoAccount ? vault.codes[logoAccount.id]?.remaining : undefined
            }
            period={logoAccount?.period ?? 30}
          />
        </div>
        <span className="brand-name" dir="ltr">
          Authenticator-For-2FA
        </span>
        <button
          className="icon-btn"
          type="button"
          aria-label={ui('lock')}
          disabled={!vault.passwordProtected || vault.locked}
          onClick={() => void vault.lock()}
        >
          <Lock size={16} />
        </button>
        <button
          className="add-btn"
          type="button"
          aria-label={ui('addAccount')}
          disabled={vault.locked}
          onClick={() => {
            setAddMode('scan');
            setView('add');
          }}
        >
          <Plus size={19} />
        </button>
        <div className={`search ${query ? 'has-text' : ''}`}>
          <Search size={16} />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setView('codes');
            }}
            aria-label={ui('searchPh')}
            placeholder={ui('searchPh')}
            autoComplete="off"
            disabled={vault.locked}
          />
          <button
            className="clear"
            type="button"
            aria-label={ui('clearSearch')}
            onClick={() => setQuery('')}
          >
            <X size={14} />
          </button>
        </div>
      </header>
      <main ref={body} className="p-body" inert={vault.locked || undefined}>
        {vault.locked ? null : !vault.initialized || !contextReady ? (
          <div className="empty visible" role="status">
            Authenticator-For-2FA
          </div>
        ) : (
          <div className="view active" key={view}>
            {view === 'codes' && (
              <AccountList
                query={query}
                context={context}
                source={browserWindow.current}
                revealedAccountIds={scannedAccountIds}
                onEdit={(account) => {
                  setEditing(account);
                  setView('edit');
                }}
                onQr={showQr}
                onCopy={(code, fill) => void copy(code, fill)}
              />
            )}
            {view === 'data' && (
              <ImportExportView onQr={showQr} onImported={celebrate} />
            )}
            {view === 'settings' && <SettingsView onNavigate={setView} />}
            {view === 'password' && (
              <PasswordView onBack={() => setView('settings')} />
            )}
            {view === 'passkey' && (
              <PasskeyView
                onBack={() => setView('settings')}
                onProtect={() => setView('password')}
              />
            )}
            {view === 'sync' && (
              <SyncView
                onBack={() => setView('settings')}
                onProtect={() => setView('password')}
              />
            )}
            {view === 'add' && (
              <>
                <Header
                  title={ui('addTitle')}
                  onBack={() => setView('codes')}
                />
                <div
                  className="seg join"
                  role="group"
                  aria-label={ui('addTitle')}
                >
                  {(['scan', 'manual'] as const).map((mode) => (
                    <button
                      type="button"
                      key={mode}
                      className={`btn join-item ${mode === addMode ? 'active' : ''}`}
                      aria-pressed={mode === addMode}
                      onClick={() => setAddMode(mode)}
                    >
                      {ui(mode === 'scan' ? 'segScan' : 'segManual')}
                    </button>
                  ))}
                </div>
                {addMode === 'manual' ? (
                  <AccountForm
                    onSaved={() => {
                      setView('codes');
                      celebrate();
                    }}
                  />
                ) : (
                  <Scanner
                    onImported={(ids, onComplete) => {
                      setScannedAccountIds(ids);
                      setQuery('');
                      celebrate(onComplete);
                    }}
                    onPageScan={pageScan}
                  />
                )}
              </>
            )}
            {view === 'edit' && editing && (
              <>
                <Header
                  title={ui('editTitle')}
                  onBack={() => setView('codes')}
                />
                <AccountForm
                  initial={editing}
                  onSaved={() => setView('codes')}
                  onDelete={() => setDeleting(editing)}
                />
              </>
            )}
            {view === 'qr' && qrAccounts.length > 0 && (
              <QrView
                accounts={qrAccounts}
                onBack={() => {
                  setQrAccountIds([]);
                  setView(qrFrom.current);
                }}
              />
            )}
          </div>
        )}
      </main>
      <nav className="p-nav" inert={vault.locked || undefined}>
        {(
          [
            { value: 'codes', key: 'navCodes', Icon: KeyRound },
            { value: 'data', key: 'navData', Icon: Database },
            { value: 'settings', key: 'navSettings', Icon: Settings }
          ] as const
        ).map(({ value, key, Icon }) => (
          <button
            key={value}
            aria-label={ui(key)}
            type="button"
            className={navView === value ? 'active' : ''}
            aria-current={navView === value ? 'page' : undefined}
            onClick={() => {
              setView(value);
              if (body.current) body.current.scrollTop = 0;
            }}
          >
            <Icon size={19} />
            <span>{ui(key)}</span>
          </button>
        ))}
      </nav>
      {!vault.locked && celebration > 0 && (
        <Confetti key={celebration} onComplete={finishCelebration} />
      )}
      {vault.locked && (
        <LockScreen
          ready={contextReady}
          requestPasskey={
            pendingRoute.current === 'unlock-passkey' ||
            (initialUnlock.current && vault.settings.passkeyDefault === true)
          }
          onUnlocked={() => {
            setContextReady(false);
            void refreshContext().finally(() => setContextReady(true));
          }}
        />
      )}
      {vault.notice && !vault.locked && (
        <div className="toast show" role="status">
          {feedback(vault.notice, vault.noticeLanguage)}
        </div>
      )}
      {vault.error && !vault.locked && view !== 'password' && (
        <div className="alert-message" role="alert">
          <span>{feedback(vault.error)}</span>
          <button
            className="btn btn-ghost"
            type="button"
            aria-label={tr('cancel')}
            onClick={() => {
              vault.error = '';
            }}
          >
            <X size={12} />
          </button>
        </div>
      )}
      {!vault.locked && deleting && (
        <Confirm
          title={ui('deleteAccount')}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            void vault
              .deleteAccount(deleting)
              .then(() => {
                setDeleting(null);
                setEditing(null);
                setView('codes');
              })
              .catch((error) => {
                vault.error = getErrorMessage(error, tr('accountChanged'));
              });
          }}
        >
          <p className="desc">
            {deleting.issuer} · {deleting.label}
          </p>
        </Confirm>
      )}
    </div>
  );
}
function LockScreen({
  ready,
  requestPasskey,
  onUnlocked
}: {
  ready: boolean;
  requestPasskey: boolean;
  onUnlocked: () => void;
}) {
  const vault = useVault(),
    { ui, tr } = useCopy();
  const [password, setPassword] = useState('');
  const attemptedPasskey = useRef(false);
  const unlockPasskey = useCallback(async () => {
    attemptedPasskey.current = true;
    await vault.unlockPasskey();
    if (!vault.locked) onUnlocked();
  }, [vault, onUnlocked]);
  useEffect(() => {
    if (
      attemptedPasskey.current ||
      !requestPasskey ||
      !ready ||
      vault.locking ||
      vault.busy ||
      !vault.initialized ||
      !vault.locked ||
      !vault.passkeyRegistered
    )
      return;
    attemptedPasskey.current = true;
    void unlockPasskey();
  }, [
    vault,
    ready,
    requestPasskey,
    vault.locking,
    vault.busy,
    vault.initialized,
    vault.locked,
    unlockPasskey
  ]);
  async function unlock() {
    await vault.unlock(password);
    setPassword('');
    if (!vault.locked) onUnlocked();
  }
  return (
    <div className="lock-screen show">
      <div className="lock-content">
        <div className="lock-emblem">
          <Logo size={52} />
        </div>
        <h2 className="sr-only">{ui('locked')}</h2>
        <p>{tr('unlockTitle')}</p>
        <form
          className="lock-form"
          onSubmit={(event) => {
            event.preventDefault();
            void unlock();
          }}
        >
          <Password
            label={tr('password')}
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={!ready || vault.busy || vault.locking}
          />
          <div className="btn-row">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={!ready || vault.busy || vault.locking || !password}
            >
              {ui('unlock')}
            </button>
            <button
              className="btn btn-soft"
              type="button"
              disabled={!ready || vault.busy || vault.locking}
              onClick={() => void unlockPasskey()}
            >
              {tr('passkey')}
            </button>
            {vault.touchIDEnabled && (
              <button
                className="btn btn-soft"
                type="button"
                disabled={!ready || vault.busy || vault.locking}
                onClick={() => {
                  void vault.unlockTouchID().then(() => {
                    if (!vault.locked) onUnlocked();
                  });
                }}
              >
                {workspaceCopy(vault.settings.language, 'touchIDUnlock')}
              </button>
            )}
          </div>
        </form>
        <div className="lock-feedback">
          <ErrorMessage>{vault.error}</ErrorMessage>
        </div>
      </div>
    </div>
  );
}
