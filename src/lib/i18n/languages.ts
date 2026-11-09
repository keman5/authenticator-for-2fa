const nativeNames = {
  en: 'English',
  es: 'Español',
  hi: 'हिन्दी',
  ar: 'العربية',
  bn: 'বাংলা',
  pt: 'Português',
  ru: 'Русский',
  ja: '日本語',
  fr: 'Français',
  de: 'Deutsch',
  zh: '简体中文',
  'zh-TW': '繁體中文',
  ko: '한국어',
  tr: 'Türkçe'
} as const;

export type LanguageCode = keyof typeof nativeNames;
export const DEFAULT_LANGUAGE: LanguageCode = 'en';
export const LANGUAGES = (Object.keys(nativeNames) as LanguageCode[]).map(
  (code) => ({ code, label: nativeNames[code] })
);

export function resolveSupportedLanguage(
  preferences: readonly unknown[]
): LanguageCode {
  for (const candidate of preferences) {
    if (typeof candidate !== 'string') continue;
    try {
      const locale = new Intl.Locale(candidate.trim().replaceAll('_', '-'));
      if (
        locale.language === 'zh' &&
        (locale.script === 'Hant' ||
          locale.region === 'TW' ||
          locale.region === 'HK')
      )
        return 'zh-TW';
      if (Object.hasOwn(nativeNames, locale.language))
        return locale.language as LanguageCode;
    } catch {
      // A malformed preference must not prevent trying the next locale.
    }
  }
  return DEFAULT_LANGUAGE;
}

export function detectBrowserLanguage(): LanguageCode {
  const preferences: unknown[] = [];
  try {
    preferences.push(globalThis.chrome?.i18n?.getUILanguage?.());
  } catch {
    // Browser preferences remain available if the extension API fails.
  }
  try {
    const browser = globalThis.navigator;
    if (Array.isArray(browser?.languages))
      preferences.push(...browser.languages);
    preferences.push(browser?.language);
  } catch {
    // Some restricted contexts expose no navigator preferences.
  }
  return resolveSupportedLanguage(preferences);
}
