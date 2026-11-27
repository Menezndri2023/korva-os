import type { Locale } from "@korva/types";

/** KORVA's legal pages. Kept apart from their content so the public footer can link to them
 *  without importing the pages themselves (which import the footer). */
export type LegalPage = "notice" | "terms" | "privacy" | "refunds" | "contact";

export const LEGAL_PATHS: Record<LegalPage, Record<Locale, string>> = {
  notice: { fr: "/mentions-legales", en: "/en/legal-notice" },
  terms: { fr: "/conditions/generales", en: "/en/terms" },
  privacy: { fr: "/confidentialite", en: "/en/privacy" },
  refunds: { fr: "/conditions/remboursement", en: "/en/terms/refunds" },
  contact: { fr: "/contact", en: "/en/contact" },
};

export const LEGAL_TITLES: Record<LegalPage, Record<Locale, string>> = {
  notice: { fr: "Mentions légales", en: "Legal notice" },
  terms: { fr: "Conditions générales", en: "Terms and conditions" },
  privacy: { fr: "Politique de confidentialité", en: "Privacy policy" },
  refunds: { fr: "Remboursement et résiliation", en: "Refunds and cancellation" },
  contact: { fr: "Contact", en: "Contact" },
};

/** Every legal page, in the order the footer lists them. */
export const LEGAL_PAGES: LegalPage[] = ["terms", "refunds", "privacy", "notice", "contact"];
