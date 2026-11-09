import { useState, type FormEvent } from 'react';
import { useCopy, useVault } from '../../app/vault';
import {
  ErrorMessage,
  Field,
  Select,
  Segmented
} from '../../shared/ui/controls';
import { getErrorMessage, AccountChangedError } from '../../domain/feedback';
import type {
  AccountDraft,
  AuthenticatorAccount,
  OtpAlgorithm,
  OtpType
} from '../../domain/view';
import { NUMERIC_OTP_DIGITS } from '../../domain/records';

export function AccountForm({
  initial,
  onSaved,
  onDelete
}: {
  initial?: AuthenticatorAccount;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const vault = useVault(),
    { ui, tr } = useCopy();
  const [draft, setDraft] = useState<AccountDraft>(() =>
    initial
      ? { ...initial }
      : {
          issuer: '',
          label: '',
          secret: '',
          site: '',
          type: 'totp',
          algorithm: 'SHA-1',
          digits: 6,
          period: 30,
          counter: 0
        }
  );
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const patch = (value: Partial<AccountDraft>) => {
    setDraft((previous) => ({ ...previous, ...value }));
    setError('');
  };
  async function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (initial) await vault.updateAccount(initial, draft);
      else await vault.addAccount(draft);
      onSaved();
    } catch (error) {
      setError(
        error instanceof AccountChangedError
          ? tr('accountChanged')
          : getErrorMessage(error, 'Unable to complete the action.')
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} noValidate>
      <div className="field">
        <label htmlFor="account-issuer">{ui('mName')}</label>
        <input
          type="text"
          id="account-issuer"
          value={draft.issuer}
          onChange={(e) => patch({ issuer: e.target.value })}
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label htmlFor="account-label">{ui('mAcct')}</label>
        <input
          type="text"
          id="account-label"
          value={draft.label}
          onChange={(e) => patch({ label: e.target.value })}
          required
          autoComplete="off"
        />
      </div>
      <div className="field">
        <label htmlFor="account-secret">{ui('mSecret')}</label>
        <input
          type="text"
          id="account-secret"
          value={draft.secret}
          onChange={(e) => patch({ secret: e.target.value })}
          required
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <div className="field">
        <label htmlFor="account-site">{ui('eSite')}</label>
        <input
          type="text"
          id="account-site"
          value={draft.site ?? ''}
          onChange={(e) => patch({ site: e.target.value })}
          placeholder={ui('eSitePh')}
          autoComplete="off"
        />
      </div>
      <Field label={tr('type')}>
        <Segmented
          label={tr('type')}
          value={draft.type ?? 'totp'}
          options={['totp', 'hotp', 'steam'].map((value) => ({
            value,
            label: tr(value as OtpType)
          }))}
          onChange={(value) => patch({
            type: value as OtpType,
            ...(value !== 'steam' && !NUMERIC_OTP_DIGITS.some((digits) => digits === draft.digits)
              ? { digits: NUMERIC_OTP_DIGITS[0] }
              : {})
          })}
        />
      </Field>
      <Field label={ui('digitsLabel')}>
        <Select
          label={ui('digitsLabel')}
          value={String(draft.type === 'steam' ? 5 : draft.digits)}
          disabled={draft.type === 'steam'}
          options={(draft.type === 'steam' ? [5] : NUMERIC_OTP_DIGITS).map((value) => ({
            value: String(value),
            label: String(value)
          }))}
          onChange={(value) => patch({ digits: Number(value) })}
        />
      </Field>
      <div className="field">
        <label htmlFor="account-period">
          {draft.type === 'hotp' ? tr('counter') : ui('stepLabel')}
        </label>
        <input
          id="account-period"
          type="number"
          min={draft.type === 'hotp' ? 0 : 5}
          max={draft.type === 'hotp' ? undefined : 300}
          value={draft.type === 'hotp' ? draft.counter : draft.period}
          onChange={(e) =>
            patch(
              draft.type === 'hotp'
                ? { counter: Number(e.target.value) }
                : { period: Number(e.target.value) }
            )
          }
          required
          disabled={draft.type === 'steam'}
        />
      </div>
      <Field label={ui('algoLabel')}>
        <Segmented
          label={ui('algoLabel')}
          value={draft.algorithm ?? 'SHA-1'}
          disabled={draft.type === 'steam'}
          options={['SHA-1', 'SHA-256', 'SHA-512'].map((value) => ({
            value,
            label: value
          }))}
          onChange={(value) => patch({ algorithm: value as OtpAlgorithm })}
        />
      </Field>
      <div className="btn-row">
        <button className="btn-primary" type="submit" disabled={busy}>
          {ui(initial ? 'save' : 'saveAccount')}
        </button>
        {onDelete && (
          <button
            className="btn-danger-soft"
            type="button"
            onClick={onDelete}
            disabled={busy}
          >
            {ui('deleteAccount')}
          </button>
        )}
      </div>
      <ErrorMessage>{error}</ErrorMessage>
    </form>
  );
}
