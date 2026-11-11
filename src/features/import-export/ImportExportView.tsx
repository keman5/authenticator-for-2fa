import { localizeQrError } from './importFeedback';
import { useState } from 'react';
import { useCopy, useVault } from '../../app/vault';
import {
  Confirm,
  ErrorMessage,
  Field,
  FilePicker,
  Password,
  Segmented
} from '../../shared/ui/controls';
import {
  createEncryptedBackupFile,
  createPlainOtpAuthFile,
  downloadFile,
  readPortableBackup
} from '../../domain/portable';
import { readImportFiles } from '../../domain/files';
import { getErrorMessage } from '../../domain/feedback';
import type { AuthenticatorAccount, ImportResult } from '../../domain/view';

export function ImportExportView({
  onQr,
  onImported
}: {
  onQr: (accounts: AuthenticatorAccount[]) => void;
  onImported?: () => void;
}) {
  const vault = useVault(),
    { ui, tr } = useCopy();
  const [importMode, setImportMode] = useState('file'),
    [text, setText] = useState(''),
    [password, setPassword] = useState(''),
    [format, setFormat] = useState('enc'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [exportPassword, setExportPassword] = useState(''),
    [plainConfirm, setPlainConfirm] = useState(false),
    [wipe, setWipe] = useState(false),
    [deleteConfirmation, setDeleteConfirmation] = useState(''),
    [status, setStatus] = useState('');
  const [pending, setPending] = useState<{ name: string; text: string }[]>([]);
  function report(result: ImportResult) {
    if (result.imported) {
      onImported?.();
      setStatus(tr('importAddedCount', { count: result.imported }));
      setText('');
    } else
      setError(
        result.errors[0] ??
          tr(result.skipped ? 'importAllDuplicates' : 'importNoneFound')
      );
  }
  async function importText() {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      report(
        readPortableBackup(text)
          ? await vault.importEncryptedBackupText(text, password)
          : await vault.importText(text)
      );
    } catch (error) {
      setError(localizeQrError(getErrorMessage(error, tr('importFailed')), tr));
    } finally {
      setBusy(false);
    }
  }
  async function importFiles(files: File[]) {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const selection = await readImportFiles(files);
      let imported = 0,
        skipped = 0;
      const errors = [...selection.errors];
      for (const document of selection.texts) {
        try {
          const result = await vault.importText(document);
          imported += result.imported;
          skipped += result.skipped;
          errors.push(...result.errors);
        } catch (error) {
          errors.push(
            localizeQrError(getErrorMessage(error, tr('importFailed')), tr)
          );
        }
      }
      if (selection.encrypted.length)
        setPending((previous) => [...previous, ...selection.encrypted]);
      if (imported) {
        setStatus(tr('importAddedCount', { count: imported }));
        onImported?.();
      }
      if (errors.length)
        setError(
          errors.map((message) => localizeQrError(message, tr)).join('\n')
        );
      else if (!imported && !selection.encrypted.length)
        setError(tr(skipped ? 'importAllDuplicates' : 'importNoneFound'));
    } catch (error) {
      setError(localizeQrError(getErrorMessage(error, tr('importFailed')), tr));
    } finally {
      setBusy(false);
    }
  }
  async function importPending() {
    if (!pending[0]) return;
    setBusy(true);
    setError('');
    try {
      report(await vault.importEncryptedBackupText(pending[0].text, password));
      setPending((previous) => previous.slice(1));
      setPassword('');
    } catch (error) {
      setError(localizeQrError(getErrorMessage(error, tr('importFailed')), tr));
    } finally {
      setBusy(false);
    }
  }
  async function exportFile() {
    setBusy(true);
    setError('');
    try {
      if (format === 'enc') {
        const file = await createEncryptedBackupFile(
          vault.accounts,
          vault.settings,
          exportPassword
        );
        downloadFile({
          ...file,
          filename: file.filename.replace(/\.json$/, '.2fa')
        });
      } else if (format === 'json')
        downloadFile({
          filename: 'authenticator-for-2fa-backup.json',
          blob: new Blob(
            [
              JSON.stringify(
                {
                  app: '2fa-authenticator',
                  version: 1,
                  exportedAt: new Date().toISOString(),
                  accounts: vault.accounts
                },
                null,
                2
              )
            ],
            { type: 'application/json' }
          )
        });
      else downloadFile(createPlainOtpAuthFile(vault.accounts));
      await vault.updateSettings({ lastBackupAt: new Date().toISOString() });
      vault.showNotice(tr('exportDone'));
      setExportPassword('');
      setPlainConfirm(false);
    } catch (error) {
      setError(getErrorMessage(error, tr('exportFailed')));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="section-label">{ui('importSec')}</div>
      <section className="import-panel" aria-label={ui('importSec')}>
        <Segmented
          label={ui('importSec')}
          value={importMode}
          disabled={busy}
          onChange={(mode) => {
            setImportMode(mode);
            setError('');
            setStatus('');
          }}
          options={[
            { value: 'file', label: tr('importFile') },
            { value: 'text', label: tr('importPaste') }
          ]}
        />
        {importMode === 'file' ? (
          <>
            <p className="desc">{tr('importFileHint')}</p>
            <div className="btn-row export-actions">
              <FilePicker
                route="import"
                accept=".json,.txt,.2fa,image/*"
                onFiles={(files) => void importFiles(files)}
                onError={setError}
                disabled={busy}
              >
                {ui('pickFile')}
              </FilePicker>
            </div>
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="import-text">{ui('importTextLabel')}</label>
              <textarea
                id="import-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={ui('importTextPh')}
              />
            </div>
            <Password
              label={ui('importPwdLabel')}
              value={password}
              onChange={setPassword}
            />
            <div className="btn-row export-actions">
              <button
                className="btn btn-primary"
                type="button"
                onClick={() => void importText()}
                disabled={busy || !text.trim()}
              >
                {ui('importBtn')}
              </button>
            </div>
          </>
        )}
        {pending[0] && (
          <div>
            {importMode === 'file' && (
              <Password
                label={ui('importPwdLabel')}
                value={password}
                onChange={setPassword}
              />
            )}
            <p className="desc" style={{ marginBlock: 10 }}>
              {tr('importEncryptedPrompt')} · {pending[0].name}
            </p>
            <div className="btn-row">
              <button
                className="btn btn-primary"
                type="button"
                disabled={busy || !password}
                onClick={() => void importPending()}
              >
                {tr('import')}
              </button>
              <button
                className="btn btn-soft"
                type="button"
                disabled={busy}
                onClick={() => {
                  setPending((previous) => previous.slice(1));
                  setPassword('');
                }}
              >
                {tr('cancel')}
              </button>
            </div>
          </div>
        )}
        <ErrorMessage>{plainConfirm ? '' : error}</ErrorMessage>
        {status && (
          <p className="scan-msg ok" role="status">
            {status}
          </p>
        )}
      </section>
      <div className="section-label">{ui('exportSec')}</div>
      <section className="export-panel" aria-label={ui('exportSec')}>
        <Field label={ui('exportFmtLabel')}>
          <Segmented
            label={ui('exportFmtLabel')}
            value={format}
            disabled={busy}
            onChange={(value) => {
              setFormat(value);
              setExportPassword('');
            }}
            options={[
              { value: 'enc', label: '.2fa' },
              { value: 'json', label: 'JSON' },
              { value: 'txt', label: 'otpauth' }
            ]}
          />
          <p className="desc">
            {ui(
              format === 'enc'
                ? 'fmtEnc'
                : format === 'json'
                  ? 'fmtJson'
                  : 'fmtTxt'
            )}
          </p>
        </Field>
        <p className="desc">{ui('exportDesc')}</p>
        {format === 'enc' && (
          <div>
            <Password
              label={tr('backupPassword')}
              value={exportPassword}
              onChange={setExportPassword}
              autoComplete="new-password"
              disabled={busy}
            />
            <p className="desc">{tr('passwordHint')}</p>
          </div>
        )}
        <div className="btn-row export-actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={
              busy ||
              !vault.accounts.length ||
              (format === 'enc' && exportPassword.length < 1)
            }
            onClick={() => {
              if (format === 'enc') void exportFile();
              else setPlainConfirm(true);
            }}
          >
            {ui('exportBtn')}
          </button>
          <button
            className="btn btn-soft"
            type="button"
            disabled={busy || !vault.accounts.length}
            onClick={() => onQr(vault.sortedAccounts)}
          >
            {ui('migQr')}
          </button>
        </div>
        <p className="last-backup">
          {vault.settings.lastBackupAt
            ? ui('lastBackupAt', {
                time: new Date(vault.settings.lastBackupAt).toLocaleString(
                  vault.settings.language,
                  { dateStyle: 'short', timeStyle: 'short' }
                )
              })
            : ui('lastBackupNone')}
        </p>
      </section>
      <div className="section-label">{ui('dangerSec')}</div>
      <div className="list-card">
        <button
          className="list-row"
          type="button"
          onClick={() => {
            setDeleteConfirmation('');
            setError('');
            setWipe(true);
          }}
        >
          <span className="tx">
            <b style={{ color: 'var(--red)' }}>{ui('wipe')}</b>
            <small>{ui('wipeDesc')}</small>
          </span>
          <span className="chev">›</span>
        </button>
      </div>
      {plainConfirm && (
        <Confirm
          title={tr('plainWarning')}
          danger={false}
          busy={busy}
          onCancel={() => {
            setPlainConfirm(false);
            setError('');
          }}
          onConfirm={() => void exportFile()}
        >
          <ErrorMessage>{error}</ErrorMessage>
        </Confirm>
      )}
      {wipe && (
        <Confirm
          title={ui('wipe')}
          busy={busy || deleteConfirmation !== 'DELETE'}
          onCancel={() => setWipe(false)}
          onConfirm={() => {
            if (deleteConfirmation !== 'DELETE') return;
            setBusy(true);
            setError('');
            void vault
              .resetVault()
              .then(() => {
                setWipe(false);
              })
              .catch((error) => setError(getErrorMessage(error)))
              .finally(() => setBusy(false));
          }}
        >
          <div className="field">
            <label htmlFor="delete-confirmation">
              {tr('deleteVaultConfirm')}
            </label>
            <input
              id="delete-confirmation"
              type="text"
              value={deleteConfirmation}
              onChange={(event) => setDeleteConfirmation(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          {vault.syncEnabled && (
            <p className="desc">{tr('syncLocalDeleteHint')}</p>
          )}
          <ErrorMessage>{error}</ErrorMessage>
        </Confirm>
      )}
    </>
  );
}
