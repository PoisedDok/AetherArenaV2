export const SUPPORTED_LOCALES = ["en-US"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en-US";

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function normalizeLocale(locale: string | null | undefined): Locale {
  if (!locale) {
    return DEFAULT_LOCALE;
  }
  if (isLocale(locale)) {
    return locale;
  }
  return DEFAULT_LOCALE;
}

// Browser hint is ignored for locale selection; UI is English-only.
export function detectLocale(): Locale {
  return DEFAULT_LOCALE;
}
