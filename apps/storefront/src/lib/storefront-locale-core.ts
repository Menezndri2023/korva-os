import { localeFrom, type Locale } from "@korva/types";

/**
 * A business's site speaks the business's language (Organization.language, chosen in its
 * Settings), not the visitor's: the business writes its own offers, and a site that switched
 * its buttons to English around French product names would read as broken.
 */
export function siteLocale(language: string | null | undefined): Locale {
  return localeFrom(language);
}

/** `t("Réserver", "Book")`: the French text and its English side by side, as in the dashboard. */
export type Translate = (fr: string, en: string) => string;

export function translator(locale: Locale): Translate {
  return (fr, en) => (locale === "en" ? en : fr);
}

/** The Intl locale for prices and dates on the site. */
export function intlLocale(locale: Locale): string {
  return locale === "en" ? "en-GB" : "fr-FR";
}
