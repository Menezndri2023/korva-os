/**
 * How KORVA is named, for search engines. People will type "korva", "korva os", "korva suite" or
 * the domain "korvasuite"; Google matches those against the page title, the visible text and the
 * names declared in the WebSite/Organization structured data (its "site name" feature reads
 * `name` and `alternateName` from the home page's WebSite block). Kept in one place so the
 * title, the share preview and the structured data never drift apart.
 */
export const BRAND_NAME = "KORVA OS";

/** Every other name the product goes by, most likely search first. */
export const BRAND_ALTERNATE_NAMES = ["KORVA", "Korva Suite", "KorvaSuite", "korvasuite.com"];

/**
 * The company behind KORVA OS. Declared as the Organization's parentOrganization and shown in
 * the footer: the group's own site already presents KORVA OS and links here, so search engines
 * can tie the two together.
 */
export const PUBLISHER = {
  name: "VIT GLOBAL TECHNOLOGIES GROUP",
  url: "https://vit-global.tech",
  /** The group's page about KORVA OS. */
  productPage: "https://vit-global.tech/fr/realisations/korva-os-gestion-entreprise",
  /** The group's public profiles, given by the owner on 2026-11-09 (canonical www hosts). */
  profiles: [
    "https://www.facebook.com/profile.php?id=61596240321319",
    "https://www.tiktok.com/@vitglobaltech",
  ],
};

/**
 * KORVA's own profiles (Facebook, Instagram, LinkedIn, TikTok…): the `sameAs` of the
 * Organization, the strongest signal that "KORVA" the search and this site are one entity.
 * Only real, public addresses belong here.
 */
export const BRAND_PROFILES: string[] = [];

export const HOME_TITLE_FR = "KORVA OS — logiciel de gestion et site internet pour votre entreprise";
export const HOME_DESCRIPTION_FR =
  "KORVA OS (Korva Suite) : clients, rendez-vous, commandes, stock, caisse, factures et site " +
  "internet dans un seul compte. Wave, Orange Money et carte. Gratuit pour commencer.";

export const HOME_TITLE_EN = "KORVA OS — business management software and website for small businesses";
export const HOME_DESCRIPTION_EN =
  "KORVA OS (Korva Suite): customers, appointments, orders, stock, till, invoices and a website " +
  "in one account. Wave, Orange Money and card payments. Free to start.";
