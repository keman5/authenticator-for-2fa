import { expect, test } from 'vitest';
import { localizeFeedback } from '../../src/lib/i18n/feedback';
import { LANGUAGES } from '../../src/lib/i18n/languages';
import { MESSAGE_KEYS, t } from '../../src/lib/i18n/messages';

const diagnostics = [
  ['Account name is required.', 'accountNameRequired'],
  ['Secret must be Base32 using A-Z and 2-7.', 'secretInvalid'],
  ['Secret is too short.', 'secretInvalid'],
  ['Invalid Base32 character "!".', 'secretInvalid'],
  ['Digits must be between 5 and 10.', 'otpParametersInvalid'],
  ['Unsupported OTP algorithm "MD5".', 'otpParametersInvalid'],
  ['counter must be a non-negative whole number.', 'otpParametersInvalid'],
  ['Current password is incorrect.', 'passwordIncorrect'],
  ['Backup password is incorrect.', 'backupPasswordWrong'],
  ['Passkey registration was cancelled.', 'passkeyFailed'],
  ['Backup file format is not supported.', 'dataInvalid'],
  ['Unlock the vault before making changes.', 'unlockRequired'],
  ['Page scan failed.', 'scanPageFailed'],
  [
    'No QR code was found near that click or in the selected area.',
    'qrNotFound'
  ],
  ['Settings saved.', 'noticeSaved'],
  ['Vault password set.', 'noticePasswordSet'],
  ['Vault password removed.', 'noticePasswordRemoved'],
  ['Account removed.', 'noticeAccountRemoved'],
  ['An unrecognized browser error.', 'actionFailed']
] as const;

test.each(LANGUAGES)(
  'feedback uses $code for domain, browser errors and notices',
  ({ code }) => {
    for (const [message, key] of diagnostics) {
      expect(localizeFeedback(code, message)).toBe(t(code, key));
      if (code !== 'en')
        expect(localizeFeedback(code, message)).not.toBe(t('en', key));
    }
    expect(localizeFeedback(code, '3 accounts imported.')).toBe(
      t(code, 'importAddedCount', { count: 3 })
    );
    expect(
      localizeFeedback(code, 'backup.txt: File is too large to import.')
    ).toBe(`backup.txt: ${t(code, 'fileTooLarge')}`);
    expect(
      localizeFeedback(code, 'File could not be read.\nSecret is too short.')
    ).toBe(`${t(code, 'fileUnreadable')}\n${t(code, 'secretInvalid')}`);
    for (const key of MESSAGE_KEYS) {
      const localized = t(code, key, {
        count: 2,
        issuer: 'Example',
        label: 'alice'
      });
      expect(localizeFeedback(code, localized), key).toBe(localized);
    }
  }
);

test.each(['constructor', 'toString', '__proto__'])(
  'unknown diagnostic %s uses the localized fallback',
  (message) => {
    expect(localizeFeedback('zh', message)).toBe(t('zh', 'actionFailed'));
  }
);


test.each(LANGUAGES.filter(({ code }) => code !== 'en'))('$code does not fall back to English for hints or feedback', ({ code }) => {
  for (const key of MESSAGE_KEYS.filter((key) => /Hint$|Failed$|Wrong$|Invalid$|Required$|^notice|^passwordHint$/.test(key))) {
    expect(t(code, key), key).not.toBe(t('en', key));
  }
});
