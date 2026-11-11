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
import App from '../../src/app/App';
import { VaultProvider } from '../../src/app/vault';
import { PasskeyView } from '../../src/features/settings/SettingsView';
import { AuthenticatorVault } from '../../src/platform/controller';
import { enrollPasskey } from '../../src/platform/passkey';
import { readWorkspace } from '../../src/platform/repository';
import {
  installStructuredCloneChromeStorage,
  MemoryStorage
} from '../helpers/storage';
declare const jsdom: { reconfigure(options: { url: string }): void };
const initialUrl = window.location.href;
afterEach(() => {
  cleanup();
  jsdom.reconfigure({ url: initialUrl });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function protectedVault(prefer = false, registered = true) {
  installStructuredCloneChromeStorage();
  vi.stubGlobal('localStorage', new MemoryStorage());
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  const credential = {
    rawId: new Uint8Array([1, 2, 3]).buffer,
    getClientExtensionResults: () => ({
      prf: { results: { first: new Uint8Array(32).fill(7).buffer } }
    })
  };
  const get = vi.fn().mockResolvedValue(credential);
  vi.stubGlobal('navigator', {
    language: 'en',
    languages: ['en'],
    platform: 'MacIntel',
    credentials: { create: vi.fn().mockResolvedValue(credential), get }
  });
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.addAccount({
    issuer: 'Example',
    label: 'alice',
    secret: 'JBSWY3DPEHPK3PXP'
  });
  await vault.changePassword('', '1');
  await vault.updateSettings({ passkeyDefault: prefer });
  if (registered)
    await enrollPasskey(
      new Uint8Array(32).buffer,
      (await readWorkspace()).gate!.proof
    );
  await vault.lock();
  expect(vault.passkeyRegistered).toBe(registered);
  expect(vault.settings.passkeyDefault).toBe(prefer);
  return { vault, get };
}
test.each([false, true])(
  'Firefox toolbar passkey authentication transfers first; window failure %s',
  async (failure) => {
    jsdom.reconfigure({ url: 'moz-extension://test/index.html' });
    const { vault, get } = await protectedVault();
    const close = vi.spyOn(window, 'close').mockImplementation(() => {});
    const create = vi.fn(
      (_data: chrome.windows.CreateData, done: () => void) => {
        if (failure)
          Object.defineProperty(chrome.runtime, 'lastError', {
            configurable: true,
            value: { message: 'Window unavailable' }
          });
        done();
        Object.defineProperty(chrome.runtime, 'lastError', {
          configurable: true,
          value: undefined
        });
      }
    );
    Object.assign(chrome, {
      extension: { getViews: () => [window] },
      windows: {
        create,
        getCurrent: (done: (x: { id: number }) => void) => done({ id: 8 })
      }
    });
    render(<App vault={vault} />);
    await screen.findByLabelText('Password');
    fireEvent.click(screen.getByRole('button', { name: 'Passkey' }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(
      new URL(create.mock.calls[0]![0].url as string).searchParams.get('open')
    ).toBe('unlock-passkey');
    expect(get).not.toHaveBeenCalled();
    if (failure) {
      expect(close).not.toHaveBeenCalled();
      expect(await screen.findByRole('alert')).toBeTruthy();
    } else await waitFor(() => expect(close).toHaveBeenCalledOnce());
  }
);
test('an explicit passkey handoff authenticates once in the persistent destination and opens Codes', async () => {
  jsdom.reconfigure({
    url: 'moz-extension://test/index.html?open=unlock-passkey'
  });
  const { vault, get } = await protectedVault();
  render(<App vault={vault} />);
  await screen.findByRole('button', { name: 'Copy: Example alice' });
  expect(get).toHaveBeenCalledOnce();
  expect(screen.queryByRole('region', { name: 'Import' })).toBeNull();
  await act(() => vault.lock());
  await screen.findByLabelText('Password');
  expect(vault.locked).toBe(true);
  expect(get).toHaveBeenCalledOnce();
});
test('the saved default authenticates on entry; a manual lock waits for a passkey click', async () => {
  const { vault, get } = await protectedVault(true);
  const reopened = new AuthenticatorVault();
  await reopened.initialize();
  expect(reopened.settings.passkeyDefault).toBe(true);
  render(<App vault={vault} />);
  await screen.findByRole('button', { name: 'Copy: Example alice' });
  expect(get).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Lock' }));
  const passkey = await screen.findByRole('button', { name: 'Passkey' });
  await waitFor(() => expect(passkey.hasAttribute('disabled')).toBe(false));
  expect(vault.locked).toBe(true);
  expect(get).toHaveBeenCalledOnce();

  fireEvent.click(passkey);
  await screen.findByRole('button', { name: 'Copy: Example alice' });
  expect(get).toHaveBeenCalledTimes(2);
});
test('opening a fresh panel loads the saved preference before automatically authenticating', async () => {
  const { get } = await protectedVault(true);
  const reopened = new AuthenticatorVault();
  expect(reopened.initialized).toBe(false);
  render(<App vault={reopened} />);
  await screen.findByRole('button', { name: 'Copy: Example alice' });
  expect(get).toHaveBeenCalledOnce();
  expect(reopened.settings.passkeyDefault).toBe(true);
});
test('cancelling automatic authentication leaves password usable and does not loop', async () => {
  const { vault, get } = await protectedVault(true);
  get.mockRejectedValue(new DOMException('Cancelled', 'NotAllowedError'));
  render(<App vault={vault} />);
  await screen.findByRole('alert');
  const password = screen.getByLabelText('Password');
  expect(document.activeElement).toBe(password);
  fireEvent.change(password, { target: { value: '1' } });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(get).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }));
  await screen.findByRole('button', { name: 'Copy: Example alice' });
});
test('an enabled preference without a registered credential does not request authentication', async () => {
  const { vault, get } = await protectedVault(true, false);
  render(<App vault={vault} />);
  await screen.findByLabelText('Password');
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByLabelText('Password'))
  );
  expect(get).not.toHaveBeenCalled();
  expect(vault.locked).toBe(true);
});

test('passkey settings toggle persists a local default and can turn it off again', async () => {
  const { vault } = await protectedVault();
  await vault.unlock('1');
  render(
    <VaultProvider vault={vault}>
      <PasskeyView onBack={() => {}} onProtect={() => {}} />
    </VaultProvider>
  );
  const toggle = screen.getByRole('switch', { name: 'Use passkey by default' });
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('true'));
  expect((await readWorkspace()).preferences.passkeyDefault).toBe(true);
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  );
  expect((await readWorkspace()).preferences.passkeyDefault).toBe(false);
});
test('with the default disabled a compatible credential still waits for a click', async () => {
  const { vault, get } = await protectedVault();
  render(<App vault={vault} />);
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Passkey' }).hasAttribute('disabled')
    ).toBe(false)
  );
  expect(get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Passkey' }));
  await screen.findByRole('button', { name: 'Copy: Example alice' });
  expect(get).toHaveBeenCalledOnce();
});
test('cancelled automatic authentication can be retried explicitly', async () => {
  const { vault, get } = await protectedVault(true);
  get.mockRejectedValueOnce(new DOMException('Cancelled', 'NotAllowedError'));
  render(<App vault={vault} />);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Passkey' }));
  await screen.findByRole('button', { name: 'Copy: Example alice' });
  expect(get).toHaveBeenCalledTimes(2);
});
test('Firefox default unlock transfers the toolbar to a persistent window automatically', async () => {
  jsdom.reconfigure({ url: 'moz-extension://test/index.html' });
  const { vault, get } = await protectedVault(true);
  const create = vi.fn((_data: chrome.windows.CreateData, done: () => void) =>
    done()
  );
  vi.spyOn(window, 'close').mockImplementation(() => {});
  Object.assign(chrome, {
    extension: { getViews: () => [window] },
    windows: { create }
  });
  render(<App vault={vault} />);
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(
    new URL(create.mock.calls[0]![0].url as string).searchParams.get('open')
  ).toBe('unlock-passkey');
  expect(get).not.toHaveBeenCalled();
});
