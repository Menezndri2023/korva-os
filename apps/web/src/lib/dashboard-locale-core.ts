import { DEFAULT_LOCALE, isLocale, type Locale } from "@korva/types";

/** The browser's remembered language, shared by the public pages and the dashboard. */
export const LOCALE_STORAGE_KEY = "korva-lang";

// The choice made in this tab: it still applies when the browser refuses to store it (private
// browsing), and wins over what is stored until the page reloads.
let chosen: Locale | null = null;

export function rememberLocale(locale: Locale) {
  chosen = locale;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Private browsing: the choice holds for this tab only.
  }
}

/** The dashboard language outside React (the API client's own messages). */
export function readDashboardLocale(): Locale {
  if (chosen) return chosen;
  if (typeof window === "undefined") return DEFAULT_LOCALE;
  try {
    const value = localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** The Intl locale for dates and numbers in the dashboard's language. */
export function intlLocale(locale: Locale): string {
  return locale === "en" ? "en-GB" : "fr-FR";
}
