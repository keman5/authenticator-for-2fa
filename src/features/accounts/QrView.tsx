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
  const [selectedId, setSelectedId] = useState(accounts[0]?.id),
    [rendered, setRendered] = useState({ uri: '', image: '' }),
    [error, setError] = useState('');
  const account =
    accounts.find((account) => account.id === selectedId) ?? accounts[0];
  const index = account ? accounts.indexOf(account) : 0;
  const uri = account ? accountToOtpAuthUri(account) : '';
  const image = rendered.uri === uri ? rendered.image : '';
  useEffect(() => {
    let current = true;
    setError('');
    if (!uri) return;
    void renderQrDataUrl(uri)
      .then((url) => {
        if (current) setRendered({ uri, image: url });
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
              setSelectedId(
                accounts[(index - 1 + accounts.length) % accounts.length]?.id
              )
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
            onClick={() =>
              setSelectedId(accounts[(index + 1) % accounts.length]?.id)
            }
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
