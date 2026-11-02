import type { BusinessModel, Locale } from "@korva/types";

/**
 * The words of a public site that depend on the trade rather than on the template. Two templates
 * serve several trades — "salon" also dresses a guesthouse, "vitrine" an estate agency and an
 * association — and their own copy ("Prendre rendez-vous", "Nos services") reads wrong there.
 * Each template passes its usual words; the trade overrides only what differs.
 */
export interface SiteWording {
  /** Header link to the full catalogue. */
  catalogLink: string;
  /** Section above the offers. */
  eyebrow: string;
  title: string;
  /** The hero's call to action. */
  heroCta: string;
  /** The button on each bookable offer. */
  book: string;
}

const BY_TRADE: Partial<Record<BusinessModel, Partial<SiteWording>>> = {
  lodging: {
    catalogLink: "Toutes nos chambres",
    eyebrow: "Séjours",
    title: "Nos chambres",
    heroCta: "Réserver un séjour",
    book: "Réserver",
  },
  real_estate: {
    catalogLink: "Tous nos biens",
    eyebrow: "À vendre et à louer",
    title: "Nos biens",
    heroCta: "Voir nos biens",
    book: "Demander une visite",
  },
  association: {
    catalogLink: "Adhésions et dons",
    eyebrow: "Nous soutenir",
    title: "Adhérer et donner",
    heroCta: "Nous rejoindre",
    book: "S'inscrire",
  },
};

const BY_TRADE_EN: Partial<Record<BusinessModel, Partial<SiteWording>>> = {
  lodging: {
    catalogLink: "All our rooms",
    eyebrow: "Stays",
    title: "Our rooms",
    heroCta: "Book a stay",
    book: "Book",
  },
  real_estate: {
    catalogLink: "All our properties",
    eyebrow: "For sale and to let",
    title: "Our properties",
    heroCta: "See our properties",
    book: "Ask for a viewing",
  },
  association: {
    catalogLink: "Membership and donations",
    eyebrow: "Support us",
    title: "Join and give",
    heroCta: "Join us",
    book: "Sign up",
  },
};

export function siteWording(
  businessModel: BusinessModel | undefined,
  template: SiteWording,
  locale: Locale = "fr",
): SiteWording {
  const byTrade = locale === "en" ? BY_TRADE_EN : BY_TRADE;
  return { ...template, ...(businessModel ? byTrade[businessModel] : undefined) };
}
