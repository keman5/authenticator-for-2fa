import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { emptyWorkspace } from '../src/domain/records';
import { DEFAULT_SETTINGS } from '../src/domain/view';
import { AuthenticatorVault } from '../src/platform/controller';
import { DOCUMENT_KEY, validateWorkspace } from '../src/platform/repository';
import { installMemoryStorage, installStructuredCloneChromeStorage } from './helpers/storage';

beforeEach(() => {
  installMemoryStorage();
  installStructuredCloneChromeStorage();
});
afterEach(() => vi.unstubAllGlobals());

test('new workspaces hide codes by default, including after saving and reopening', async () => {
  expect(DEFAULT_SETTINGS.hideCodes).toBe(true);
  expect(emptyWorkspace().preferences.conceal).toBe(true);
  const vault = new AuthenticatorVault();
  await vault.initialize();
  expect(vault.settings.hideCodes).toBe(true);
  await vault.addAccount({ label: 'alice', secret: 'JBSWY3DPEHPK3PXP' });
  const reopened = new AuthenticatorVault();
  await reopened.initialize();
  expect(reopened.settings.hideCodes).toBe(true);
});

test.each([undefined, true, false])('missing hide-codes preference defaults on and explicit %s is preserved', async conceal => {
  const workspace = emptyWorkspace();
  if (conceal === undefined) Reflect.deleteProperty(workspace.preferences, 'conceal');
  else workspace.preferences.conceal = conceal;
  expect(validateWorkspace(workspace).preferences.conceal).toBe(conceal ?? true);
  await new Promise<void>(resolve => chrome.storage.local.set({ [DOCUMENT_KEY]: workspace }, resolve));
  const vault = new AuthenticatorVault();
  await vault.initialize();
  expect(vault.settings.hideCodes).toBe(conceal ?? true);
  await vault.updateSettings({ hideCodes: false });
  const reopened = new AuthenticatorVault();
  await reopened.initialize();
  expect(reopened.settings.hideCodes).toBe(false);
});
