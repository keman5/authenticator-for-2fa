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
import { AccountList } from '../../src/features/accounts/AccountList';
import { VaultProvider } from '../../src/app/vault';
import { AuthenticatorVault } from '../../src/platform/controller';
import { installStructuredCloneChromeStorage } from '../helpers/storage';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
test('folded All keeps favorites visible alongside site matches and reveals the remaining accounts on demand', async () => {
  installStructuredCloneChromeStorage();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.addAccount({
    issuer: 'Favorite',
    label: 'favorite-user',
    secret: 'JBSWY3DPEHPK3PXP',
    favorite: true
  });
  await vault.addAccount({
    issuer: 'Example',
    label: 'site-user',
    secret: 'KRSXG5DSMFWHK3DM',
    site: 'example.com'
  });
  await vault.addAccount({
    issuer: 'Other',
    label: 'other-user',
    secret: 'MZXW6YTBOI======'
  });
  render(
    <VaultProvider vault={vault}>
      <AccountList
        query=""
        context={{ hostname: 'example.com' }}
        onEdit={() => {}}
        onQr={() => {}}
        onCopy={() => {}}
      />
    </VaultProvider>
  );
  expect(
    screen.getByRole('button', { name: 'Copy: Favorite favorite-user' })
  ).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Copy: Example site-user' })
  ).toBeTruthy();
  expect(screen.queryByText('Current site · example.com')).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Copy: Other other-user' })
  ).toBeNull();
  fireEvent.click(
    screen.getByRole('button', { name: 'Show all accounts (1)' })
  );
  expect(
    screen.getByRole('button', { name: 'Copy: Other other-user' })
  ).toBeTruthy();
});
test('a matched site icon is reused when reopened away from the site and cleared by reset', async () => {
  installStructuredCloneChromeStorage();
  const icon = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRwAAAABJRU5ErkJggg==';
  const sendMessage = vi.fn((_request, reply) => reply({ ok: true, value: icon }));
  Object.assign(chrome.runtime, { sendMessage });
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.addAccount({ issuer: 'Example', label: 'user', site: 'example.com', secret: 'JBSWY3DPEHPK3PXP' });
  const show = (hostname?: string) => render(
    <VaultProvider vault={vault}>
      <AccountList query="" context={hostname ? { hostname } : null} onEdit={() => {}} onQr={() => {}} onCopy={() => {}} />
    </VaultProvider>
  );
  try {
    const initial = show('example.com');
    await waitFor(() => expect(initial.container.querySelector('.avatar img')?.getAttribute('src')).toBe(icon));
    initial.unmount();
    const reopened = show();
    expect(reopened.container.querySelector('.avatar img')?.getAttribute('src')).toBe(icon);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    reopened.unmount();
    await vault.resetVault();
    expect(localStorage.getItem('site-icons-v1')).toBeNull();
  } finally {
    localStorage.removeItem('site-icons-v1');
  }
});
test('keyboard manual ordering persists without consuming or modifying OTP secrets', async () => {
  installStructuredCloneChromeStorage();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.importText(
    'otpauth://totp/Example:one?secret=JBSWY3DPEHPK3PXP\notpauth://totp/Example:two?secret=KRSXG5DSMFWHK3DM'
  );
  await vault.updateSettings({ accountSortMode: 'manual' });
  const secret = vault.sortedAccounts[1].secret;
  render(
    <VaultProvider vault={vault}>
      <AccountList
        query=""
        context={null}
        onEdit={() => {}}
        onQr={() => {}}
        onCopy={() => {}}
      />
    </VaultProvider>
  );
  const handles = screen.getAllByRole('button', {
    name: 'Drag to reorder: Example'
  });
  await act(async () => {
    fireEvent.keyDown(handles[1], { key: 'ArrowUp' });
  });
  expect(vault.sortedAccounts.map((account) => account.label)).toEqual([
    'two',
    'one'
  ]);
  expect(vault.sortedAccounts[0].secret).toBe(secret);
  const reopened = new AuthenticatorVault();
  await reopened.initialize();
  expect(reopened.sortedAccounts.map((account) => account.label)).toEqual([
    'two',
    'one'
  ]);
});

test('keyboard ordering follows the displayed favorite groups and stops at their boundaries', async () => {
  installStructuredCloneChromeStorage();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  for (const issuer of ['A', 'B', 'C']) {
    await vault.addAccount({
      issuer,
      label: `${issuer}-user`,
      secret: 'JBSWY3DPEHPK3PXP',
      favorite: issuer === 'B'
    });
  }
  await vault.updateSettings({
    accountSortMode: 'manual',
    alwaysShowAllCodes: true
  });
  render(
    <VaultProvider vault={vault}>
      <AccountList
        query=""
        context={null}
        onEdit={() => {}}
        onQr={() => {}}
        onCopy={() => {}}
      />
    </VaultProvider>
  );
  const visibleOrder = () =>
    screen
      .getAllByRole('button', { name: /^Copy:/ })
      .map((node) => node.getAttribute('aria-label'));
  expect(visibleOrder()).toEqual([
    'Copy: B B-user',
    'Copy: A A-user',
    'Copy: C C-user'
  ]);
  await act(async () => {
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Drag to reorder: A' }),
      { key: 'ArrowDown' }
    );
  });
  expect(visibleOrder()).toEqual([
    'Copy: B B-user',
    'Copy: C C-user',
    'Copy: A A-user'
  ]);
  await act(async () => {
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Drag to reorder: C' }),
      { key: 'ArrowUp' }
    );
    fireEvent.keyDown(
      screen.getByRole('button', { name: 'Drag to reorder: B' }),
      { key: 'ArrowDown' }
    );
  });
  expect(visibleOrder()).toEqual([
    'Copy: B B-user',
    'Copy: C C-user',
    'Copy: A A-user'
  ]);
  const reopened = new AuthenticatorVault();
  await reopened.initialize();
  expect(reopened.sortedAccounts.map((account) => account.issuer)).toEqual([
    'B',
    'C',
    'A'
  ]);
});

test('a scanned account is visible while unrelated accounts stay folded', async () => {
  installStructuredCloneChromeStorage();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.importText(
    'otpauth://totp/Scanned:alice?secret=JBSWY3DPEHPK3PXP&issuer=Scanned\notpauth://totp/Other:bob?secret=KRSXG5DSMFWHK3DM&issuer=Other'
  );
  render(
    <VaultProvider vault={vault}>
      <AccountList
        query=""
        context={null}
        revealedAccountIds={[vault.accounts[0].id]}
        onCopy={() => {}}
        onEdit={() => {}}
        onQr={() => {}}
      />
    </VaultProvider>
  );
  expect(
    screen.getByRole('button', { name: 'Copy: Scanned alice' })
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Copy: Other bob' })).toBeNull();
});

test('only expiring time-based codes turn red and restart the flash each second', async () => {
  installStructuredCloneChromeStorage();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.importText(
    'otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example\notpauth://hotp/Counter:bob?secret=KRSXG5DSMFWHK3DM&issuer=Counter&counter=1'
  );
  await vault.updateSettings({ alwaysShowAllCodes: true });
  const first = vault.accounts[0],
    counter = vault.accounts[1];
  const setRemaining = (remaining: number) => {
    vault.codes = {
      [first.id]: {
        accountId: first.id,
        value: '123456',
        remaining,
        progress: remaining / 30
      },
      [counter.id]: {
        accountId: counter.id,
        value: '654321',
        remaining: 0,
        progress: 0
      }
    };
  };
  setRemaining(6);
  render(
    <VaultProvider vault={vault}>
      <AccountList
        query=""
        context={null}
        onCopy={() => {}}
        onEdit={() => {}}
        onQr={() => {}}
      />
    </VaultProvider>
  );
  const code = () =>
    screen
      .getByRole('button', { name: 'Copy: Example alice' })
      .querySelector('.code')!;
  expect(code().classList.contains('low')).toBe(false);
  await act(async () => setRemaining(5));
  expect(code().classList.contains('low')).toBe(true);
  const previous = code();
  await act(async () => setRemaining(4));
  expect(code()).not.toBe(previous);
  expect(
    screen
      .getByRole('button', { name: 'Copy: Counter bob' })
      .querySelector('.code')!
      .classList.contains('low')
  ).toBe(false);
  await act(async () => setRemaining(30));
  expect(code().classList.contains('low')).toBe(false);
});

test('Favorites precedes Current site and only the hovered or keyboard-focused account reveals its hidden code', async () => {
  installStructuredCloneChromeStorage();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.importText('otpauth://totp/Example:one?secret=JBSWY3DPEHPK3PXP\notpauth://totp/Example:two?secret=KRSXG5DSMFWHK3DM');
  await vault.updateSettings({ hideCodes: true, alwaysShowAllCodes: true });
  const { container } = render(<VaultProvider vault={vault}><AccountList query="" context={{ hostname: 'example.com' }} onEdit={() => {}} onQr={() => {}} onCopy={() => {}} /></VaultProvider>);
  const chips = Array.from(container.querySelectorAll('.chip')).map((element) => element.textContent);
  expect(chips[1]).toBe('Favorites');
  expect(chips[2]).toContain('Current site');
  const cards = container.querySelectorAll('.card');
  expect(container.querySelectorAll('.hidden-code')).toHaveLength(2);
  fireEvent.mouseEnter(cards[0]);
  expect(cards[0].querySelector('.hidden-code')).toBeNull();
  expect(cards[1].querySelector('.hidden-code')).toBeTruthy();
  fireEvent.mouseLeave(cards[0]);
  expect(container.querySelectorAll('.hidden-code')).toHaveLength(2);
  fireEvent.focus(cards[1].querySelector('.card-main')!);
  expect(cards[1].querySelector('.hidden-code')).toBeNull();
  fireEvent.blur(cards[1].querySelector('.card-main')!, { relatedTarget: document.body });
  expect(container.querySelectorAll('.hidden-code')).toHaveLength(2);
});

test('a drag cannot overwrite account order refreshed by another panel', async () => {
  installStructuredCloneChromeStorage();
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.importText(
    'otpauth://totp/Example:one?secret=JBSWY3DPEHPK3PXP\notpauth://totp/Example:two?secret=KRSXG5DSMFWHK3DM'
  );
  await vault.updateSettings({ accountSortMode: 'manual' });
  render(
    <VaultProvider vault={vault}>
      <AccountList
        query=""
        context={null}
        onEdit={() => {}}
        onQr={() => {}}
        onCopy={() => {}}
      />
    </VaultProvider>
  );
  vi.stubGlobal('PointerEvent', MouseEvent);
  const handle = screen.getAllByRole('button', {
    name: 'Drag to reorder: Example'
  })[0];
  handle.setPointerCapture = vi.fn();
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1 });
  expect(document.querySelector('.card.dragging')).not.toBeNull();
  const remoteOrder = [...vault.sortedAccounts]
    .reverse()
    .map((account) => account.id);
  await act(() => vault.reorderAccounts(remoteOrder));
  const commit = vi.spyOn(vault, 'reorderAccounts');
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(commit).not.toHaveBeenCalled();
  expect(vault.sortedAccounts.map((account) => account.id)).toEqual(
    remoteOrder
  );
  expect(document.querySelector('.card.dragging')).toBeNull();
});
