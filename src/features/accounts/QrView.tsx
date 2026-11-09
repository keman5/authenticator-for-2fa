import { useEffect, useState } from 'react';
import { useCopy, useVault } from '../../app/vault';
import { ErrorMessage, Header } from '../../shared/ui/controls';
import { renderQrDataUrl } from '../../domain/qr';
import { accountToOtpAuthUri } from '../../domain/transfer';
import { getErrorMessage } from '../../domain/feedback';
import type { AuthenticatorAccount } from '../../domain/view';

export function QrView({
  accounts,
  onBack
}: {
  accounts: AuthenticatorAccount[];
  onBack: () => void;
}) {
  const { ui, tr } = useCopy(),
    vault = useVault();
  const [index, setIndex] = useState(0),
    [image, setImage] = useState(''),
    [error, setError] = useState('');
  const account = accounts[index];
  const uri = account ? accountToOtpAuthUri(account) : '';
  useEffect(() => {
    let current = true;
    setImage('');
    setError('');
    void renderQrDataUrl(uri)
      .then((url) => {
        if (current) setImage(url);
      })
      .catch((error) => {
        if (current) setError(getErrorMessage(error, tr('exportFailed')));
      });
    return () => {
      current = false;
    };
  }, [uri]);
  return (
    <>
      <Header title={ui('qrDefault')} onBack={onBack} />
      <div className="qr-box">
        {image && <img src={image} alt={ui('qrDefault')} />}
      </div>
      <p className="desc" style={{ textAlign: 'center' }}>
        {account?.issuer} · {account?.label}
      </p>
      <div className="uri-box" style={{ marginTop: 10, userSelect: 'text' }}>
        {uri}
      </div>
      {accounts.length > 1 && (
        <div className="qr-pagination">
          <button
            className="btn-soft"
            type="button"
            onClick={() =>
              setIndex((index - 1 + accounts.length) % accounts.length)
            }
          >
            {ui('prev')}
          </button>
          <span className="muted" aria-live="polite">
            {index + 1} / {accounts.length}
          </span>
          <button
            className="btn-soft"
            type="button"
            onClick={() => setIndex((index + 1) % accounts.length)}
          >
            {ui('next')}
          </button>
        </div>
      )}
      <div className="qr-actions">
        <button
          className="btn-soft"
          type="button"
          disabled={!uri}
          onClick={() => {
            void navigator.clipboard
              .writeText(uri)
              .then(() => vault.showNotice(ui('copiedUri')))
              .catch(() => setError(tr('copyFailed')));
          }}
        >
          {ui('copyLink')}
        </button>
        {image && (
          <a
            className="btn-soft"
            href={image}
            download={`${
              [account.issuer, account.label]
                .filter(Boolean)
                .join('-')
                .replace(/[<>:"/\\|?*\p{Cc}]/gu, '-')
                .slice(0, 180) || 'account'
            }.png`}
          >
            {tr('export')}
          </a>
        )}
      </div>
      <ErrorMessage>{error}</ErrorMessage>
    </>
  );
}
