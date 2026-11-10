import { useEffect, useState } from 'react';
import { ChevronDown, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { useCopy, useVault } from '../../app/vault';
import { Confirm, ErrorMessage, Header } from '../../shared/ui/controls';
import {
  generateSyncRecoveryKey,
  parseSyncRecoveryKey
} from '../../platform/sync';
import { getSyncErrorKey, getSyncStatusKey } from './status';

export function SyncView({
  onBack,
  onProtect
}: {
  onBack: () => void;
  onProtect: () => void;
}) {
  const vault = useVault(),
    { ui, tr } = useCopy();
  const [mode, setMode] = useState<'idle' | 'create' | 'join'>('idle'),
    [key, setKey] = useState(''),
    [saved, setSaved] = useState(false),
    [revealed, setRevealed] = useState(false),
    [error, setError] = useState(''),
    [working, setWorking] = useState(false),
    [confirmation, setConfirmation] = useState<'stop' | 'delete' | null>(null);
  const busy = working || vault.busy || vault.syncStatus === 'syncing';
  useEffect(
    () => () => {
      vault.syncError = null;
    },
    [vault]
  );
  async function connect() {
    if (busy || (mode === 'create' && !saved)) return;
    setError('');
    try {
      const parsed = parseSyncRecoveryKey(key);
      setWorking(true);
      await vault.startBrowserSync(parsed, mode === 'join');
      if (vault.syncEnabled) {
        setMode('idle');
        setKey('');
        setSaved(false);
      }
    } catch {
      setError(tr('syncWrongKey'));
    } finally {
      setWorking(false);
    }
  }
  function choose(next: 'create' | 'join') {
    setError('');
    vault.syncError = null;
    setSaved(false);
    setKey(next === 'create' ? generateSyncRecoveryKey() : '');
    setMode(next);
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      vault.showNotice(tr('copied'));
    } catch {
      setError(tr('syncKeyCopyFailed'));
    }
  }
  async function sync() {
    if (busy) return;
    setError('');
    setWorking(true);
    try {
      await vault.syncNow();
      if (vault.syncStatus === 'ready') vault.showNotice(tr('syncReady'));
    } finally {
      setWorking(false);
    }
  }
  function confirm(next: 'stop' | 'delete' | null) {
    setError('');
    vault.syncError = '';
    setConfirmation(next);
  }
  async function disconnect() {
    setWorking(true);
    try {
      const removeGroup = confirmation === 'delete';
      await (removeGroup ? vault.deleteBrowserSync() : vault.stopBrowserSync());
      if (vault.syncEnabled) return;
      setConfirmation(null);
      setRevealed(false);
    } finally {
      setWorking(false);
    }
  }
  return (
    <>
      <Header
        title={ui('syncName')}
        onBack={() => {
          setError('');
          vault.syncError = null;
          if (mode === 'idle') onBack();
          else {
            setMode('idle');
            setKey('');
            setSaved(false);
          }
        }}
      />
      <details className="sync-help">
        <summary>
          <ShieldCheck size={16} aria-hidden="true" />
          <span>{ui('howSec')}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <div className="how-card">
          {(
            ['syncFeatureEncrypted', 'syncFeatureBrowser', 'syncScope'] as const
          ).map((key, index) => (
            <div className="how-step" key={key}>
              <span className="n">{index + 1}</span>
              <p>{tr(key)}</p>
            </div>
          ))}
        </div>
      </details>
      <p className="muted" style={{ marginTop: 8 }}>
        {tr('syncRequirements')}
      </p>
      {!vault.syncAvailable ? (
        <ErrorMessage>{tr('syncUnavailable')}</ErrorMessage>
      ) : !vault.passwordProtected ? (
        <div className="sync-panel" style={{ marginTop: 14 }}>
          <p className="desc">{tr('syncProtectionRequired')}</p>
          <div className="btn-row" style={{ marginTop: 16 }}>
            <button
              className="btn btn-primary"
              type="button"
              onClick={onProtect}
            >
              {tr('setPassword')}
            </button>
          </div>
        </div>
      ) : vault.syncEnabled ? (
        <>
          <div className="section-label">
            <label htmlFor="sync-recovery-key">{tr('syncRecoveryKey')}</label>
          </div>
          <section className="sync-panel sync-key-panel">
            <div className="field">
              <div className="recovery-wrap">
                {revealed ? (
                  <textarea
                    id="sync-recovery-key"
                    value={vault.syncRecoveryKey}
                    readOnly
                    title={ui('copyRecovery')}
                    onClick={() => void copy(vault.syncRecoveryKey)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter')
                        void copy(vault.syncRecoveryKey);
                    }}
                    rows={2}
                    spellCheck={false}
                  />
                ) : (
                  <input
                    id="sync-recovery-key"
                    value={vault.syncRecoveryKey}
                    readOnly
                    title={ui('copyRecovery')}
                    onClick={() => void copy(vault.syncRecoveryKey)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter')
                        void copy(vault.syncRecoveryKey);
                    }}
                    type="password"
                    spellCheck={false}
                  />
                )}
                <button
                  className="eye-btn"
                  type="button"
                  aria-label={tr(revealed ? 'syncHideKey' : 'syncShowKey')}
                  aria-pressed={revealed}
                  onClick={() => setRevealed(!revealed)}
                >
                  {revealed ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            <p className="muted">{tr('syncRecoveryHint')}</p>
          </section>
          <div className="section-label">{ui('syncOpsSec')}</div>
          <div className="sync-panel">
            <div className="btn-row">
              <button
                className="btn btn-primary"
                type="button"
                disabled={busy}
                onClick={() => void sync()}
              >
                {busy ? tr('syncSyncing') : ui('syncNow')}
              </button>
              <button
                className="btn btn-soft"
                type="button"
                disabled={busy}
                onClick={() => confirm('stop')}
              >
                {tr('syncStop')}
              </button>
            </div>
            <div className="sync-divider" />
            <div className="sync-kv">
              <span className="k">{ui('kvState')}</span>
              <span className="v" role="status">
                {tr(getSyncStatusKey(vault.syncStatus))}
              </span>
            </div>
            <div className="sync-kv">
              <span className="k">{ui('kvContent')}</span>
              <span className="v">
                {tr('syncAccountCount', { count: vault.accounts.length })}
              </span>
            </div>
            <p className="desc">{tr('syncDeliveryHint')}</p>
          </div>
          <div className="section-label">{ui('dangerSec')}</div>
          <div className="list-card">
            <button
              className="list-row"
              type="button"
              disabled={busy}
              onClick={() => confirm('delete')}
            >
              <span className="tx">
                <b style={{ color: 'var(--red)' }}>{tr('syncDelete')}</b>
                <small>{tr('syncDeleteDescription')}</small>
              </span>
              <span className="chev">›</span>
            </button>
          </div>
        </>
      ) : mode === 'idle' ? (
        <div className="list-card" style={{ marginTop: 14 }}>
          <button
            className="list-row"
            type="button"
            onClick={() => choose('create')}
          >
            <span className="tx">
              <b>{tr('syncStart')}</b>
              <small>{tr('syncStartHint')}</small>
            </span>
            <span className="chev">›</span>
          </button>
          <button
            className="list-row"
            type="button"
            onClick={() => choose('join')}
          >
            <span className="tx">
              <b>{tr('syncConnect')}</b>
              <small>{tr('syncConnectHint')}</small>
            </span>
            <span className="chev">›</span>
          </button>
        </div>
      ) : (
        <>
          <div className="section-label">
            {tr(mode === 'create' ? 'syncCreateTitle' : 'syncJoinTitle')}
          </div>
          <form
            className="sync-panel sync-key-panel sync-key-form"
            onSubmit={(event) => {
              event.preventDefault();
              void connect();
            }}
          >
            <p className="desc">
              {tr(mode === 'create' ? 'syncRecoveryHint' : 'syncJoinHint')}
            </p>
            <div className="field">
              <label htmlFor="sync-key">{tr('syncRecoveryKey')}</label>
              <textarea
                id="sync-key"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                readOnly={mode === 'create'}
                rows={2}
                title={mode === 'create' ? ui('copyRecovery') : undefined}
                onClick={() => {
                  if (mode === 'create') void copy(key);
                }}
                onKeyDown={(event) => {
                  if (mode === 'create' && event.key === 'Enter') {
                    event.preventDefault();
                    void copy(key);
                  }
                }}
                spellCheck={false}
                autoComplete="off"
                placeholder="…"
              />
            </div>
            {mode === 'create' && (
              <label className="desc sync-key-confirm">
                <input
                  type="checkbox"
                  checked={saved}
                  onChange={(event) => setSaved(event.target.checked)}
                />
                <span>{tr('syncSavedKey')}</span>
              </label>
            )}
            <div className="btn-row">
              <button
                className="btn btn-primary"
                type="submit"
                disabled={busy || !key.trim() || (mode === 'create' && !saved)}
              >
                {tr(mode === 'create' ? 'syncEnable' : 'syncJoinSubmit')}
              </button>
            </div>
          </form>
        </>
      )}
      {vault.accounts.some((account) => account.type === 'hotp') && (
        <p className="desc" style={{ marginTop: 12 }}>
          {tr('syncHotpWarning')}
        </p>
      )}
      {!confirmation && (
        <ErrorMessage>
          {error ||
            (vault.syncError ? tr(getSyncErrorKey(vault.syncError)) : '')}
        </ErrorMessage>
      )}
      {confirmation && (
        <Confirm
          title={tr(
            confirmation === 'delete' ? 'syncDelete' : 'syncStopConfirm'
          )}
          busy={busy}
          onCancel={() => confirm(null)}
          onConfirm={() => void disconnect()}
        >
          <ErrorMessage>
            {error ||
              (vault.syncError ? tr(getSyncErrorKey(vault.syncError)) : '')}
          </ErrorMessage>
          <p className="desc">
            {tr(confirmation === 'delete' ? 'syncDeleteHint' : 'syncStopHint')}
          </p>
        </Confirm>
      )}
    </>
  );
}
