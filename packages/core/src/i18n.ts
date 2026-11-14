import en from './locales/en.json';

export type Messages = Record<string, string>;

const LOCALES: Record<string, Messages> = { en };

/** Register an extra locale (used by tests and future languages). */
export function registerLocale(lang: string, messages: Messages): void {
  LOCALES[lang] = messages;
}

export function availableLocales(): string[] {
  return Object.keys(LOCALES);
}

/** Look up a key with fallback chain: requested language, then English, then the key itself. */
export function t(lang: string, key: string, params: Record<string, string | number> = {}): string {
  const raw = LOCALES[lang]?.[key] ?? LOCALES.en?.[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  );
}

export function hasLocale(lang: string): boolean {
  return lang in LOCALES;
}

export function allKeys(): string[] {
  return Object.keys(LOCALES.en ?? {});
}
