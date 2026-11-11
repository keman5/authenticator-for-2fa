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
  en: 'e1928f757cf0a86fca7cd20ae3fa489327cd86b2c61d7f1c5e54701e5ca48024',
  es: '6b571b190d082f730caf054220cf641ac52395a178671b9c5c23d9b7bb62dad3',
  hi: 'e0f2f7b816ae19c4e8cc8319920ac25c2e2252b223d3b8694afce9ab0c5c1cec',
  ar: '8f7544fa280e2c7df01946c48c39883a2012dc80d561ef4ded17dd2d7c15c523',
  bn: '1a5e147ea308c07487f1d6d625195b93e3f8e4a2cefafedc23f604260e385972',
  pt: '7c39b70bb89c7741f3fdc2d8ee43ae13901dfc844e1eac73bc1d8d9f7951641f',
  ru: 'c327c0dc09280e6609fc141e8bc53b815d0201af69048e7540a95b52176ea5d1',
  ja: 'a65b618e50a8387ff71378edfe3227a2c24457637d046b61b05e6f2a7d1bf1ec',
  fr: 'dd25c3d06f150038faa3ac1234177fb70e9103af3bb2da842d78dd9ee1391c2f',
  de: '6a5d980f4035f4732b9f8b134d34a4180e4b87c4e8601f1d0ca8914601f3b787',
  zh: '63af3a44c052a88313e399d87d98f2318bc491cfe0b4235d2949c432069fbd36',
  'zh-TW': '9cce7ab31b944d2429017051d641eefa8e3df5512927c120db0ad1bfcc40dd76',
  ko: '4cbc19dd89a4c0c6cdf2c0f7cae7743affb9296849da489755b32159470d9476',
  tr: 'de7120dd6c594683fe01053345784a8c3863c044f0695c623bbcdf4f7d11f534'
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
