// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { QrView } from '../../src/features/accounts/QrView';
import { VaultProvider } from '../../src/app/vault';
import { AuthenticatorVault } from '../../src/platform/controller';
import * as qr from '../../src/domain/qr';
import { installStructuredCloneChromeStorage } from '../helpers/storage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('QR pagination stays separate from copy/export and actions follow the selected account', async () => {
  installStructuredCloneChromeStorage();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.importText(
    'otpauth://totp/First:alice?secret=JBSWY3DPEHPK3PXP&issuer=First\notpauth://totp/Second:bob?secret=KRSXG5DSMFWHK3DM&issuer=Second'
  );
  vi.spyOn(qr, 'renderQrDataUrl').mockImplementation(
    async (uri) => `data:image/png;base64,${btoa(uri)}`
  );
  const copy = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: copy }
  });
  const view = render(
    <VaultProvider vault={vault}>
      <QrView accounts={vault.accounts} onBack={() => {}} />
    </VaultProvider>
  );
  await waitFor(() =>
    expect(screen.getByRole('link', { name: 'Export' })).toBeTruthy()
  );
  expect(
    screen
      .getByRole('button', { name: 'Copy otpauth link' })
      .closest('.qr-actions')
  ).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Next' }).closest('.qr-pagination')
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() =>
    expect(
      screen.getByRole('link', { name: 'Export' }).getAttribute('download')
    ).toBe('Second-bob.png')
  );
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Copy otpauth link' }));
  });
  expect(copy.mock.calls[0][0]).toContain('Second');
  expect(view.container.querySelector('.qr-pagination')?.textContent).toContain(
    '2 / 2'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
  expect(view.container.querySelector('.qr-pagination')?.textContent).toContain(
    '1 / 2'
  );
  view.rerender(
    <VaultProvider vault={vault}>
      <QrView accounts={[vault.accounts[0]]} onBack={() => {}} />
    </VaultProvider>
  );
  expect(view.container.querySelector('.qr-pagination')).toBeNull();
});
