// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../../src/app/App';
import { AuthenticatorVault } from '../../src/platform/controller';
import { generateSyncRecoveryKey } from '../../src/platform/sync';
import { createBrowserSyncNetwork } from '../helpers/browserSync';
import { t } from '../../src/lib/i18n/messages';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function openSync() {
  createBrowserSyncNetwork().createDevice().install();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.changePassword('', '1');
  await vault.updateSettings({ language: 'en', languageMode: 'manual' });
  const user = userEvent.setup();
  render(<App vault={vault} />);
  await screen.findByRole('button', { name: 'All0' });
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  await user.click(screen.getByRole('button', { name: /Browser sync/ }));
  await user.click(screen.getByRole('button', { name: new RegExp(t('en', 'syncConnect')) }));
  return { user, vault };
}

test('returning from an invalid recovery key clears its form error before the next workflow', async () => {
  const { user } = await openSync();
  await user.type(document.getElementById('sync-key')!, 'invalid-key');
  await user.click(screen.getByRole('button', { name: t('en', 'syncJoinSubmit') }));
  expect(screen.getByRole('alert').textContent).toBe(t('en', 'syncWrongKey'));
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.queryByRole('alert')).toBeNull();
  await user.click(screen.getByRole('button', { name: new RegExp(t('en', 'syncStart')) }));
  expect(screen.queryByRole('alert')).toBeNull();
});

test.each(['Back', 'Escape', 'Codes'] as const)('leaving sync via %s clears a failed join instead of showing it on return', async exit => {
  const { user, vault } = await openSync();
  await user.type(document.getElementById('sync-key')!, generateSyncRecoveryKey());
  await user.click(screen.getByRole('button', { name: t('en', 'syncJoinSubmit') }));
  await waitFor(() => expect(vault.syncError).toBe('notFound'));
  expect(screen.getByRole('alert').textContent).toBe(t('en', 'syncNoData'));
  if (exit === 'Back') {
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Back' }));
  } else if (exit === 'Escape') await user.keyboard('{Escape}');
  else await user.click(screen.getByRole('button', { name: 'Codes' }));
  expect(vault.syncError).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Settings' }));
  await user.click(screen.getByRole('button', { name: /Browser sync/ }));
  expect(screen.queryByRole('alert')).toBeNull();
  // Clearing a dismissed message must not report a successful synchronization.
  expect(vault.syncStatus).toBe('error');
  await act(async () => {});
});
