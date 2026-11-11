import { afterEach, expect, test, vi } from 'vitest';
import {
  enrollPasskey,
  readPasskeyKey,
  loadPasskeyRecord,
  requestPasskeyAccess
} from '../../src/platform/passkey';
import { installMemoryStorage } from '../helpers/storage';
afterEach(() => vi.unstubAllGlobals());
function installCredential(prf: Uint8Array | undefined) {
  vi.stubGlobal('navigator', {
    language: 'en',
    languages: ['en'],
    credentials: {
      create: async () => ({
        rawId: new Uint8Array([1, 2, 3]).buffer,
        getClientExtensionResults: () => ({
          prf: {
            enabled: Boolean(prf),
            results: prf ? { first: prf.buffer } : undefined
          }
        })
      }),
      get: async () => ({
        rawId: new Uint8Array([1, 2, 3]).buffer,
        getClientExtensionResults: () => ({
          prf: { results: prf ? { first: prf.buffer } : undefined }
        })
      })
    }
  });
}
test('passkeys wrap a verification token with PRF and bind it to the current interface lock', async () => {
  installMemoryStorage();
  installCredential(new Uint8Array(32).fill(7));
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  await enrollPasskey(rawKey.buffer, 'vault-one');
  expect(loadPasskeyRecord()?.rpId).toBeUndefined();
  expect(JSON.stringify(loadPasskeyRecord())).not.toContain(
    btoa(String.fromCharCode(...rawKey))
  );
  expect(new Uint8Array(await readPasskeyKey('vault-one'))).toEqual(rawKey);
  await expect(readPasskeyKey('vault-two')).rejects.toThrow();
  installCredential(new Uint8Array(32).fill(8));
  await expect(readPasskeyKey('vault-one')).rejects.toThrow();
});
test('authenticators without PRF cannot enable a cosmetic vault unlock', async () => {
  installMemoryStorage();
  installCredential(undefined);
  await expect(
    enrollPasskey(new Uint8Array(32).buffer, 'vault-one')
  ).rejects.toThrow('PRF');
  expect(loadPasskeyRecord()).toBeNull();
});

test('Firefox requests only its RP site, synchronously from the registration click', async () => {
  const request = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('location', { protocol: 'moz-extension:' });
  vi.stubGlobal('chrome', { permissions: { request } });
  const access = requestPasskeyAccess();
  expect(request).toHaveBeenCalledWith({ origins: ['https://macseek.cc/*'] });
  await expect(access).resolves.toBe('macseek.cc');
  request.mockResolvedValue(false);
  await expect(requestPasskeyAccess()).rejects.toThrow('permission');
  vi.stubGlobal('location', { protocol: 'chrome-extension:' });
  request.mockClear();
  await expect(requestPasskeyAccess()).resolves.toBeUndefined();
  expect(request).not.toHaveBeenCalled();
});

test('Firefox uses the same RP for enrollment, deferred PRF evaluation and subsequent unlock', async () => {
  installMemoryStorage();
  const rawId = new Uint8Array([1, 2, 3]).buffer;
  const prf = new Uint8Array(32).fill(7).buffer;
  const create = vi.fn().mockResolvedValue({
    rawId,
    getClientExtensionResults: () => ({ prf: { enabled: true } })
  });
  const get = vi.fn().mockResolvedValue({
    rawId,
    getClientExtensionResults: () => ({ prf: { results: { first: prf } } })
  });
  vi.stubGlobal('navigator', { credentials: { create, get } });
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  await enrollPasskey(rawKey.buffer, 'firefox-vault', 'macseek.cc');
  expect(create.mock.calls[0][0].publicKey.rp.id).toBe('macseek.cc');
  expect(loadPasskeyRecord()?.rpId).toBe('macseek.cc');
  expect(new Uint8Array(await readPasskeyKey('firefox-vault'))).toEqual(rawKey);
  expect(get).toHaveBeenCalledTimes(2);
  for (const [options] of get.mock.calls)
    expect(options.publicKey.rpId).toBe('macseek.cc');
});

test('credential account labels use the browser UI language rather than hard-coded English', async () => {
  installMemoryStorage();
  installCredential(new Uint8Array(32).fill(7));
  vi.stubGlobal('chrome', { i18n: { getUILanguage: () => 'zh-CN' } });
  const create = vi.spyOn(navigator.credentials, 'create');
  await enrollPasskey(new Uint8Array(32).buffer, 'localized-proof');
  const options = create.mock.calls[0]![0] as CredentialCreationOptions;
  expect(options.publicKey!.user.name).toBe('本地验证器');
  expect(options.publicKey!.user.displayName).toBe('本地验证器');
  expect(options.publicKey!.rp.name).toBe('Authenticator-For-2FA');
});


test('registration uses the selected app language even when the browser is English', async () => {
  installMemoryStorage();
  installCredential(new Uint8Array(32).fill(7));
  vi.stubGlobal('chrome', { i18n: { getUILanguage: () => 'en' } });
  const create = vi.spyOn(navigator.credentials, 'create');
  const { AuthenticatorVault } = await import('../../src/platform/controller');
  const vault = new AuthenticatorVault();
  await vault.initialize();
  await vault.changePassword('', '1');
  await vault.updateSettings({ language: 'zh', languageMode: 'manual' });
  await vault.registerPasskey();
  const options = create.mock.calls[0]![0] as CredentialCreationOptions;
  expect(options.publicKey!.user.name).toBe('本地验证器');
  expect(options.publicKey!.user.displayName).toBe('本地验证器');
});
