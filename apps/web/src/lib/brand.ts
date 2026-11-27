import { VERTICAL_TEMPLATES } from "@korva/types";

/**
 * How KORVA is named, for search engines. People will type "korva", "korva os", "korva suite" or
 * the domain "korvasuite"; Google matches those against the page title, the visible text and the
 * names declared in the WebSite/Organization structured data (its "site name" feature reads
 * `name` and `alternateName` from the home page's WebSite block). Kept in one place so the
 * title, the share preview and the structured data never drift apart.
 */
export const BRAND_NAME = "KORVA OS";

/** Every other name the product goes by, most likely search first. */
export const BRAND_ALTERNATE_NAMES = ["KORVA", "Korva OS", "KORVA Suite", "Korva Suite", "KorvaSuite", "korvasuite.com"];

/**
 * How many trades KORVA configures — counted, never typed, so "17 métiers" in a title can never
 * outlive a trade being added.
 */
export const TRADE_COUNT = VERTICAL_TEMPLATES.length;

/**
 * Where KORVA sells: West Africa first (mobile money, franc CFA), and anywhere else in French or
 * English — the owner's answer of 2026-11-19. Given to search engines as `areaServed`.
 */
export const AREA_SERVED = [
  "Côte d'Ivoire",
  "Sénégal",
  "Mali",
  "Burkina Faso",
  "Bénin",
  "Togo",
  "Niger",
  "Guinée",
  "Cameroun",
  "Afrique de l'Ouest",
  "Afrique francophone",
  "International",
];

/**
 * What people type when they look for KORVA or for what it does. Google ignores a keywords tag;
 * Bing and some AI crawlers still read it, and the same lists feed the structured data, where
 * every engine reads them.
 */
export const BRAND_KEYWORDS_FR = [
  "KORVA",
  "KORVA OS",
  "Korva Suite",
  "korvasuite",
  "logiciel de gestion",
  "logiciel de gestion entreprise",
  "logiciel de gestion Afrique",
  "logiciel de gestion Côte d'Ivoire",
  "logiciel de gestion Sénégal",
  "logiciel de caisse",
  "logiciel de facturation",
  "gestion de stock",
  "prise de rendez-vous en ligne",
  "créer un site internet",
  "boutique en ligne",
  "paiement Wave",
  "paiement Orange Money",
  "mobile money",
  "PME",
  "commerçant",
];

export const BRAND_KEYWORDS_EN = [
  "KORVA",
  "KORVA OS",
  "Korva Suite",
  "korvasuite",
  "business management software",
  "small business software Africa",
  "point of sale software",
  "invoicing software",
  "stock management",
  "online booking",
  "website builder",
  "online shop",
  "mobile money payments",
  "Wave",
  "Orange Money",
];

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
  /** The group's identity in structured data: KORVA's Organization, SoftwareApplication and
   *  the group's own site can all point at this one node. */
  id: "https://vit-global.tech/#organization",
  /** The group's public profiles, given by the owner on 2026-11-09 and 2026-11-21 (canonical
   *  addresses: the Facebook "share" link the owner sent resolves to this same profile id). */
  profiles: [
    "https://www.facebook.com/profile.php?id=61596240321319",
    "https://www.linkedin.com/company/vit-global-technologies-group/",
    "https://www.tiktok.com/@vitglobaltech",
  ],
  /** The same profiles, named, for the footer. */
  links: [
    { label: "Facebook", url: "https://www.facebook.com/profile.php?id=61596240321319" },
    { label: "LinkedIn", url: "https://www.linkedin.com/company/vit-global-technologies-group/" },
    { label: "TikTok", url: "https://www.tiktok.com/@vitglobaltech" },
  ],
};

/** The company that sells KORVA OS — lives in @korva/types so the API's KORVA invoices print
 *  exactly the identity the legal pages show. */
export { LEGAL_ENTITY } from "@korva/types";

/**
 * KORVA's own profiles (Facebook, Instagram, LinkedIn, TikTok…): the `sameAs` of the
 * Organization, the strongest signal that "KORVA" the search and this site are one entity.
 * Only real, public addresses belong here.
 */
export const BRAND_PROFILES: string[] = [];

export const HOME_TITLE_FR = "KORVA OS — logiciel de gestion et site internet pour votre entreprise";
export const HOME_DESCRIPTION_FR =
  `KORVA OS (Korva Suite), logiciel de gestion pour ${TRADE_COUNT} métiers : clients, rendez-vous, ` +
  "commandes, stock, caisse, factures, site internet. Wave, Orange Money. Gratuit.";

export const HOME_TITLE_EN = "KORVA OS — business management software and website for small businesses";
export const HOME_DESCRIPTION_EN =
  `KORVA OS (Korva Suite), for ${TRADE_COUNT} trades: customers, appointments, orders, stock, till, ` +
  "invoices and a website. Wave, Orange Money, card. Free to start.";
