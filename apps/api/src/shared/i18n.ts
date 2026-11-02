import { localeFrom, type Locale } from '@korva/types';

/**
 * What a business's customers read — e-mails, WhatsApp messages, reminders — is written in the
 * business's language (Organization.language, French or English), never the platform's: the
 * customer chose a French or an English business, not KORVA.
 */
export type Translate = (fr: string, en: string) => string;

export function orgLocale(language: string | null | undefined): Locale {
  return localeFrom(language);
}

export function translator(language: string | null | undefined): Translate {
  const locale = orgLocale(language);
  return (fr, en) => (locale === 'en' ? en : fr);
}

/** The Intl locale for dates and amounts written into those messages. */
export function intlLocaleOf(language: string | null | undefined): string {
  return orgLocale(language) === 'en' ? 'en-GB' : 'fr-FR';
}
