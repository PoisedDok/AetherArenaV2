"use client";

import { useEffect } from "react";

import { useI18nContext } from "./context";
import { getLocaleFromCookie, setLocaleInCookie } from "./cookies";
import { enUS } from "./locales/en-US";

import {
  DEFAULT_LOCALE,
  normalizeLocale,
  type Locale,
  type Translations,
} from "./index";

const translations: Record<Locale, Translations> = {
  "en-US": enUS,
};

export function useI18n() {
  const { locale, setLocale } = useI18nContext();

  const t = translations[locale] ?? translations[DEFAULT_LOCALE];

  const changeLocale = (_newLocale: Locale) => {
    setLocale(DEFAULT_LOCALE);
    setLocaleInCookie(DEFAULT_LOCALE);
  };

  useEffect(() => {
    const saved = getLocaleFromCookie();
    const normalized = normalizeLocale(saved ?? undefined);
    setLocale(normalized);
    if (saved && saved !== normalized) {
      setLocaleInCookie(normalized);
    }
  }, [setLocale]);

  return {
    locale,
    t,
    changeLocale,
  };
}
