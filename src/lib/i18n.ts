import ar from "@/locales/ar.json";
import en from "@/locales/en.json";

export const LOCALE_COOKIE = "velora_locale";
export const DEFAULT_LOCALE = "ar" as const;

export type Locale = "ar" | "en";
export type Dictionary = typeof ar;

const dictionaries: Record<Locale, Dictionary> = {
  ar,
  en,
};

export function isLocale(value: string | undefined | null): value is Locale {
  return value === "ar" || value === "en";
}

export function resolveLocale(value: string | undefined | null): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

export function getDirection(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function setLocaleCookie(locale: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}
