import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { interfaceToVaultKey } from '../../src/lib/i18n/interfaceMap';
import { LANGUAGES, MESSAGE_KEYS, t } from '../../src/lib/i18n/messages';

const LOCALE_MESSAGES = [
  'extensionName',
  'extensionShortName',
  'extensionDescription',
  'actionTitle',
  'commandOpenPopup'
] as const;
const MANIFEST_LOCALE_BY_LANGUAGE: Record<string, string> = {
  en: 'en',
  es: 'es',
  hi: 'hi',
  ar: 'ar',
  bn: 'bn',
  pt: 'pt_BR',
  ru: 'ru',
  ja: 'ja',
  fr: 'fr',
  de: 'de',
  zh: 'zh_CN',
  'zh-TW': 'zh_TW',
  ko: 'ko',
  tr: 'tr'
};
const BROWSER_BRAND_PATTERN = /\b(?:Chrome|Chromium|Edge|Firefox|Web Store)\b/i;
const MANIFEST_LOCALES_DIR = join(
  process.cwd(),
  'assets',
  'extension',
  '_locales'
);
const CHARACTER_SEGMENTER = new Intl.Segmenter(undefined, {
  granularity: 'grapheme'
});

function characterLength(value: string): number {
  return Array.from(CHARACTER_SEGMENTER.segment(value)).length;
}

describe('localized copy', () => {
  test('every supported runtime language has non-empty values for every UI key', () => {
    for (const { code } of LANGUAGES) {
      for (const key of MESSAGE_KEYS) {
        expect(t(code, key), `${code}.${key}`).toMatch(/\S/);
      }
    }
  });

  test('runtime copy does not mention browser brands', () => {
    for (const { code } of LANGUAGES) {
      for (const key of MESSAGE_KEYS) {
        expect(t(code, key), `${code}.${key}`).not.toMatch(
          BROWSER_BRAND_PATTERN
        );
      }
    }
  });

  test('manifest locales include exported metadata', () => {
    for (const { code } of LANGUAGES) {
      const locale = MANIFEST_LOCALE_BY_LANGUAGE[code];
      const filePath = join(MANIFEST_LOCALES_DIR, locale, 'messages.json');
      expect(existsSync(filePath), locale).toBe(true);

      const messages = JSON.parse(readFileSync(filePath, 'utf8')) as Record<
        string,
        { message?: unknown }
      >;
      for (const key of LOCALE_MESSAGES) {
        expect(messages[key]?.message, `${locale}.${key}`).toEqual(
          expect.any(String)
        );
        expect(messages[key].message, `${locale}.${key}`).toMatch(/\S/);
        expect(messages[key].message, `${locale}.${key}`).not.toMatch(
          BROWSER_BRAND_PATTERN
        );
      }
    }
  });

  test('manifest short names stay within extension package limits', () => {
    for (const { code } of LANGUAGES) {
      const locale = MANIFEST_LOCALE_BY_LANGUAGE[code];
      const filePath = join(MANIFEST_LOCALES_DIR, locale, 'messages.json');
      const messages = JSON.parse(readFileSync(filePath, 'utf8')) as Record<
        string,
        { message?: unknown }
      >;
      const shortName = messages.extensionShortName?.message;

      expect(shortName, `${locale}.extensionShortName`).toEqual(
        expect.any(String)
      );
      expect(
        characterLength(String(shortName)),
        `${locale}.extensionShortName`
      ).toBeLessThanOrEqual(12);
    }
  });
});

test.each([
  ['en', /accounts/i],
  ['es', /cuentas/i],
  ['hi', /खात/],
  ['ar', /حساب/],
  ['bn', /অ্যাকাউন্ট/],
  ['pt', /conta/i],
  ['ru', /аккаунт/i],
  ['ja', /アカウント/],
  ['fr', /compte/i],
  ['de', /konten/i],
  ['zh', /账号/],
  ['zh-TW', /帳號/],
  ['ko', /계정/],
  ['tr', /hesap/i]
] as const)(
  '%s import and collection messages refer to accounts',
  (language, noun) => {
    for (const key of [
      'accounts',
      'importAllDuplicates',
      'importNoneFound',
      'empty',
      'exportCount',
      'otherCodes',
      'syncAccountCount'
    ] as const) {
      expect(t(language, key, { count: 1 })).toMatch(noun);
    }
  }
);


test('passkey unlock has a localized label in every supported language', () => {
  for (const { code } of LANGUAGES) {
    expect(t(code, 'passkey').trim()).not.toBe('');
    if (['zh', 'zh-TW', 'ko', 'ja', 'ar', 'hi', 'bn', 'ru'].includes(code))
      expect(t(code, 'passkey')).not.toBe('Passkey');
  }
});


test('Chinese OTP copy uses verification codes and preserves source code terminology', () => {
  for (const language of ['zh', 'zh-TW']) {
    for (const key of MESSAGE_KEYS) {
      if (key !== 'sourceCode') expect(t(language, key), `${language}.${key}`).not.toMatch(/代码|代碼/);
    }
    expect(t(language, 'codes')).toBe(language === 'zh' ? '验证码' : '驗證碼');
    expect(t(language, 'accounts')).toBe(language === 'zh' ? '账号' : '帳號');
  }
  expect(t('zh', 'sourceCode')).toBe('源代码');
  const manifest = JSON.parse(readFileSync(join(MANIFEST_LOCALES_DIR, 'zh_CN', 'messages.json'), 'utf8'));
  expect(manifest.extensionDescription.message).toContain('验证码');
});

test.each(LANGUAGES)('$code keeps account, code, favorites and sync labels distinct', ({ code }) => {
  const labels = [
    t(code, 'accounts'),
    t(code, interfaceToVaultKey.navCodes),
    t(code, interfaceToVaultKey.chipFav),
    t(code, interfaceToVaultKey.kvContent)
  ];
  expect(new Set(labels).size).toBe(4);
});

// Stable catalog snapshots for shared translation keys.
const catalogHashes: Record<string, string> = {
  en: 'e21c3e41f63740b4c33c99a62b26c21d5eb136f7e34c3f3f7b005dd3b861e747',
  es: 'fe2e582ce28e5e2107afc4ccf667ca72ff67dca8545cf6d2c164c5afe0ea34c0',
  hi: 'd30abe2da21fa913e87252a0aee05323ac013a31337ce1b4ace5e1f4a0ba66a2',
  ar: 'cb9421e23de3ddcb54246946a0d01fc57b80dde077b0e7ff7e3518c49fd299bb',
  bn: '2f0b225b6a79fda4d0f6fd4f6dd0831ffdf33f36e1807505958a4c05996f5362',
  pt: '709a5e11f610450612ae075ee8e652e610bf35255ad135593dfceeca66eb315e',
  ru: 'a2d462cd3fd9cac6dc82ccd4da8ab1ecf982e1b7cea4a26cca3ab721a76a0169',
  ja: 'e96a35fa67c9420cd1ad6047c795324f87b60efdb770e090e453cca6b6d0f03b',
  fr: '0bd12755b70dfc4adec73573109c6f701bfdfb5df3a587a37fd2d282c15e634d',
  de: '276075cdc64e752ee9ec4ad22c4e88d9f2c2d543df3f7900ebd97e1780e948e1',
  zh: '72edbd17c1dea88c800e73adb2ca577d2ec3aba0eaffc255f6e6749acab7ee0c',
  'zh-TW': 'a7a2919b0ae834ff394d5d1543564e66225ac9ee3067d6f806cc0be174ecc5d5',
  ko: 'ff08102d52958a20748a8175a48f7698b078b3ccd54fbfb29c8f6e9b5ea0f642',
  tr: '817f728bd78c1fa0426d535a10f3d20870ebf0cf336c830ca0f2392c4c1c06e2'
};

test.each(LANGUAGES)(
  '$code matches the stable translation catalog',
  ({ code }) => {
    const resolved = Object.fromEntries(
      // Feature-specific labels are validated separately.
      MESSAGE_KEYS.filter(
        (key) =>
          ![
            'passkeyAccountName',
            'passkeyDefault',
            'passkeyDefaultHint',
            'noticeDataCleared',
            'timeCalibration',
            'timeCalibrationHint',
            'timeCalibrateGoogle',
            'timeCalibrating',
            'timeCalibrated',
            'timeCalibrationFailed',
            'timeCalibrationPermission'
          ].includes(key)
      ).map((key) => [key, t(code, key)])
    );
    expect(
      createHash('sha256').update(JSON.stringify(resolved)).digest('hex')
    ).toBe(catalogHashes[code]);
  }
);

test('message substitution preserves missing slots, zero and empty values with an English fallback', () => {
  expect(t('unknown', 'importAddedCount', { count: 0 })).toBe(
    'Authenticator accounts added: 0'
  );
  expect(t('en', 'importAddedCount', { count: '' })).toBe(
    'Authenticator accounts added: '
  );
  expect(t('constructor', 'importAddedCount')).toBe(
    'Authenticator accounts added: {count}'
  );
  expect(t('en', 'importAddedCount', {})).toBe(
    'Authenticator accounts added: {count}'
  );
});
