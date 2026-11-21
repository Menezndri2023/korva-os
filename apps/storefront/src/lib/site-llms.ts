import { verticalForOrganizationType, verticalText } from "@korva/types";
import type { PublicOffer, PublicOrganization } from "./public-types";
import { siteLocale, translator } from "./storefront-locale-core";
import { clipText, tradeLabel } from "./seo-text";

/** Enough to say what the business sells; an assistant follows the catalogue link for the rest. */
const LISTED_OFFERS = 30;

// Plain spaces: a narrow no-break space is noise in the plain text an assistant reads.
const amount = (value: number, currency: string) =>
  `${value.toLocaleString("fr-FR").replace(/\s/g, " ")} ${currency}`;

/**
 * /<slug>/llms.txt — one business, as an AI assistant (ChatGPT, Gemini, Claude, Perplexity…)
 * should know it when someone asks "un salon de coiffure à Cocody" or "where to order attiéké":
 * who it is, where, how to reach it, what it sells at what price, and its own answers to common
 * questions. The plain Markdown format llmstxt.org proposes, built from the same public data as
 * the site, so it says nothing the site does not.
 */
export function siteLlmsText(
  organization: PublicOrganization,
  offers: PublicOffer[],
  siteUrl: string,
): string {
  const locale = siteLocale(organization.language);
  const t = translator(locale);
  const trade = verticalForOrganizationType(organization.type);
  const kind = trade ? verticalText(trade, locale).label : tradeLabel(organization.businessModel, t);
  const about = (organization.tagline || organization.aboutText)?.trim();

  const lines: string[] = [`# ${organization.name}`, ""];
  lines.push(`> ${clipText(about || `${organization.name}${kind ? ` — ${kind}` : ""}.`, 300)}`, "");

  const facts: string[] = [];
  if (kind) facts.push(`- ${t("Activité", "Business")} : ${kind}`);
  if (organization.contactAddress) facts.push(`- ${t("Adresse", "Address")} : ${organization.contactAddress}`);
  if (organization.contactPhone) facts.push(`- ${t("Téléphone", "Phone")} : ${organization.contactPhone}`);
  if (organization.whatsappNumber) facts.push(`- WhatsApp : ${organization.whatsappNumber}`);
  const rating = organization.reviewSummary;
  if (rating && rating.count > 0 && rating.average !== null) {
    facts.push(
      `- ${t("Avis clients", "Customer reviews")} : ${Math.round(rating.average * 10) / 10}/5 (${rating.count} ${t("avis", "reviews")})`,
    );
  }
  facts.push(`- ${t("Site", "Website")} : ${siteUrl}`);
  lines.push(...facts, "");

  const services: string[] = [];
  if (organization.visibleSections.includes("booking")) services.push(t("réservation en ligne", "online booking"));
  if (organization.visibleSections.includes("catalog")) services.push(t("commande en ligne", "online ordering"));
  if (services.length > 0) {
    lines.push(`${t("Sur le site", "On the website")} : ${services.join(", ")}.`, "");
  }

  const listed = offers.slice(0, LISTED_OFFERS);
  if (listed.length > 0) {
    lines.push(`## ${t("Offres", "Offers")}`);
    for (const offer of listed) {
      const price = offer.pricing.amount > 0 ? ` : ${amount(offer.pricing.amount, offer.pricing.currency)}` : "";
      const description = offer.description?.trim() ? ` — ${clipText(offer.description, 140)}` : "";
      lines.push(`- [${offer.name}](${siteUrl}/offers/${offer.id})${price}${description}`);
    }
    if (offers.length > listed.length) {
      lines.push(`- [${t("Tout le catalogue", "The whole catalogue")}](${siteUrl}/catalogue)`);
    }
    lines.push("");
  }

  const faq = (organization.faqItems ?? []).filter((item) => item.question?.trim() && item.answer?.trim());
  if (faq.length > 0) {
    lines.push(`## ${t("Questions fréquentes", "Frequently asked questions")}`);
    for (const item of faq) lines.push(`- ${item.question.trim()} ${item.answer.trim()}`);
    lines.push("");
  }

  lines.push(
    t(
      "Site créé avec KORVA OS (https://app.korvasuite.com), logiciel de gestion et site internet pour les entreprises.",
      "Website made with KORVA OS (https://app.korvasuite.com), business software and website for small businesses.",
    ),
    "",
  );
  return lines.join("\n");
}
