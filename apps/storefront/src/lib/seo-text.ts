import type { BusinessModel } from "@korva/types";
import type { PublicOrganization } from "./public-types";

type Translate = (fr: string, en: string) => string;

/** Search results cut a description at about 155-160 characters; past that is never read. */
const DESCRIPTION_MAX = 158;

/** What kind of place this is, in the words a customer types into a search ("restaurant"). */
export function tradeLabel(businessModel: BusinessModel | undefined, t: Translate): string | null {
  switch (businessModel) {
    case "retail":
      return t("Boutique en ligne", "Online shop");
    case "restaurant":
      return t("Restaurant, commande en ligne", "Restaurant, order online");
    case "appointments":
      return t("Prise de rendez-vous en ligne", "Book online");
    case "lodging":
      return t("Réservation de séjour", "Book your stay");
    case "training":
      return t("Formations et inscriptions", "Courses and sign-up");
    case "quotes":
      return t("Services et devis", "Services and quotes");
    case "real_estate":
      return t("Agence immobilière", "Real estate agency");
    case "association":
      return t("Association", "Association");
    default:
      return null;
  }
}

/**
 * The home page's title when the business wrote none: its name alone ("Freeworld") told a
 * search engine nothing about what it is, so the trade follows the name.
 */
export function siteTitle(organization: PublicOrganization, t: Translate): string {
  if (organization.seoTitle) return organization.seoTitle;
  const label = tradeLabel(organization.businessModel, t);
  return label ? `${organization.name} — ${label}` : organization.name;
}

/** Cut at a word boundary, never mid-word, with an ellipsis only when something was cut. */
export function clipText(text: string, max = DESCRIPTION_MAX): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.—-]+$/, "")}…`;
}

/**
 * The home page's description when the business wrote none: what it says about itself first,
 * then what a visitor can do there, then a few of its offers — each name once (three variants
 * of one product used to give "Offres : Coin, Coins, Coins").
 */
export function siteDescription(
  organization: PublicOrganization,
  offerNames: string[],
  t: Translate,
): string {
  if (organization.seoDescription) return organization.seoDescription;
  const parts: string[] = [];
  const own = (organization.tagline || organization.aboutText)?.trim();
  parts.push(own ? own.replace(/[.!?…]?$/, (end) => end || ".") : `${organization.name}.`);

  const services: string[] = [];
  if (organization.enabledModules.includes("booking")) services.push(t("réservation en ligne", "online booking"));
  if (organization.enabledModules.includes("commerce")) services.push(t("commande en ligne", "online ordering"));
  if (services.length > 0) {
    const list = services.join(t(" et ", " and "));
    parts.push(`${list.charAt(0).toUpperCase()}${list.slice(1)}.`);
  }

  const seen = new Set<string>();
  const unique = offerNames
    .map((name) => name.trim())
    .filter((name) => {
      const key = name.toLocaleLowerCase();
      if (!name || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3);
  if (unique.length > 0) parts.push(t(`À découvrir : ${unique.join(", ")}.`, `Featuring: ${unique.join(", ")}.`));

  return clipText(parts.join(" "));
}

/** The picture a shared link shows: a real photo of the place first, then the logo, never a placeholder. */
export function shareImage(organization: PublicOrganization): string | undefined {
  return organization.heroImage || organization.logo || undefined;
}
