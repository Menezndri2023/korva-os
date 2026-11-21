import { verticalForOrganizationType, type BusinessModel } from "@korva/types";
import type { PublicOffer, PublicOrganization } from "./public-types";

/**
 * schema.org types for a business's site, so search engines and AI assistants understand what it
 * is (a salon, a restaurant, a hotel…), where to reach it, and what it sells at what price.
 */
const BUSINESS_TYPE: Record<BusinessModel, string> = {
  retail: "Store",
  restaurant: "Restaurant",
  appointments: "HealthAndBeautyBusiness",
  lodging: "LodgingBusiness",
  training: "EducationalOrganization",
  quotes: "ProfessionalService",
  real_estate: "RealEstateAgent",
  association: "NGO",
};

/**
 * The trade, when it is known, says more than the type of activity: a hair salon and a gym both
 * take appointments, but Google files the first under "BeautySalon" and the second under
 * "ExerciseGym", and that is the category a local search ("salon de coiffure Cocody") matches.
 * Keyed by the trade templates' `key` (packages/types/src/verticals.ts); a trade missing here
 * falls back to BUSINESS_TYPE.
 */
const TRADE_TYPE: Record<string, string> = {
  beauty_wellness: "BeautySalon",
  restaurant: "Restaurant",
  professional_services: "ProfessionalService",
  training: "EducationalOrganization",
  commerce: "Store",
  // Non-medical by definition (see its template): not MedicalBusiness.
  health_practice: "HealthAndBeautyBusiness",
  trades_construction: "HomeAndConstructionBusiness",
  real_estate: "RealEstateAgent",
  hospitality: "LodgingBusiness",
  fashion_retail: "ClothingStore",
  food_retail: "GroceryStore",
  fitness_sport: "ExerciseGym",
  digital_agency: "ProfessionalService",
  events_creative: "ProfessionalService",
  nonprofit_association: "NGO",
  childcare_personal_services: "ChildCare",
  agriculture_direct_sale: "Store",
};

/** The schema.org type of this business: its trade's, else its type of activity's. */
export function businessSchemaType(organization: PublicOrganization): string {
  const trade = verticalForOrganizationType(organization.type);
  if (trade && TRADE_TYPE[trade.key]) return TRADE_TYPE[trade.key];
  return organization.businessModel ? BUSINESS_TYPE[organization.businessModel] : "LocalBusiness";
}

/** Only a two-letter ISO code is an addressCountry Google accepts. */
function countryCode(organization: PublicOrganization): string | undefined {
  const code = organization.country?.trim().toUpperCase();
  return code && /^[A-Z]{2}$/.test(code) ? code : undefined;
}

function businessImages(organization: PublicOrganization): string[] {
  return [organization.heroImage, ...(organization.heroSlides ?? []), organization.logo].filter(
    (url): url is string => Boolean(url),
  );
}

const formatAmount = (amount: number) => amount.toLocaleString("fr-FR").replace(/\s/g, " ");

/** "5 000 – 25 000 XOF": the range of what the site sells, from the offers on its home page. */
export function priceRange(offers: PublicOffer[]): string | undefined {
  const amounts = offers.map((offer) => offer.pricing?.amount).filter((n): n is number => typeof n === "number" && n > 0);
  if (amounts.length === 0) return undefined;
  const currency = offers.find((offer) => offer.pricing?.currency)?.pricing.currency ?? "";
  const low = Math.min(...amounts);
  const high = Math.max(...amounts);
  return `${low === high ? formatAmount(low) : `${formatAmount(low)} – ${formatAmount(high)}`} ${currency}`.trim();
}

/** How many offers are listed in the business block: enough to say what it sells, not a catalogue. */
const LISTED_OFFERS = 10;

export function businessJsonLd(
  organization: PublicOrganization,
  url: string,
  offers: PublicOffer[] = [],
): Record<string, unknown> {
  const rating = organization.reviewSummary;
  const country = countryCode(organization);
  const range = priceRange(offers);
  return {
    "@context": "https://schema.org",
    "@type": businessSchemaType(organization),
    "@id": `${url}#business`,
    name: organization.name,
    url,
    ...(organization.tagline || organization.aboutText
      ? { description: (organization.tagline || organization.aboutText)!.trim() }
      : {}),
    ...(organization.logo ? { logo: organization.logo } : {}),
    // Photos of the place first (Google asks LocalBusiness for real images), the logo last.
    ...(businessImages(organization).length ? { image: businessImages(organization) } : {}),
    ...(organization.contactPhone || organization.whatsappNumber
      ? { telephone: organization.contactPhone || organization.whatsappNumber }
      : {}),
    ...(organization.contactAddress || country
      ? {
          address: {
            "@type": "PostalAddress",
            ...(organization.contactAddress ? { streetAddress: organization.contactAddress } : {}),
            ...(country ? { addressCountry: country } : {}),
          },
        }
      : {}),
    ...(country ? { areaServed: { "@type": "Country", name: country } } : {}),
    knowsLanguage: organization.language === "en" ? "en" : "fr",
    currenciesAccepted: organization.currency,
    ...(range ? { priceRange: range } : {}),
    ...(offers.length
      ? {
          hasOfferCatalog: {
            "@type": "OfferCatalog",
            name: organization.name,
            itemListElement: offers.slice(0, LISTED_OFFERS).map((offer) => ({
              "@type": "Offer",
              url: `${url}/offers/${offer.id}`,
              price: offer.pricing.amount,
              priceCurrency: offer.pricing.currency,
              itemOffered: {
                "@type": isBooked(offer) ? "Service" : "Product",
                name: offer.name,
              },
            })),
          },
        }
      : {}),
    ...(rating && rating.count > 0 && rating.average !== null
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: Math.round(rating.average * 10) / 10,
            reviewCount: rating.count,
          },
        }
      : {}),
  };
}

/**
 * The business's own questions and answers, as a FAQPage: the format AI assistants quote most
 * readily, and the one place a business answers "do you deliver?" in its own words.
 */
export function faqJsonLd(organization: PublicOrganization): Record<string, unknown> | null {
  const items = (organization.faqItems ?? []).filter((item) => item.question?.trim() && item.answer?.trim());
  if (items.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question.trim(),
      acceptedAnswer: { "@type": "Answer", text: item.answer.trim() },
    })),
  };
}

/** Everything the home page declares: the business, then its FAQ when it wrote one. */
export function homeJsonLd(
  organization: PublicOrganization,
  url: string,
  offers: PublicOffer[] = [],
): Record<string, unknown>[] {
  const faq = faqJsonLd(organization);
  return [businessJsonLd(organization, url, offers), ...(faq ? [faq] : [])];
}

const isBooked = (offer: PublicOffer) => offer.type === "booking" || offer.type === "service";

/** A product or, for something booked, a service — with its price, as search engines show it. */
export function offerJsonLd(
  offer: PublicOffer,
  organization: PublicOrganization,
  url: string,
): Record<string, unknown> {
  const booked = isBooked(offer);
  return {
    "@context": "https://schema.org",
    "@type": booked ? "Service" : "Product",
    name: offer.name,
    ...(offer.description?.trim() ? { description: offer.description.trim() } : {}),
    ...(offer.images.length ? { image: offer.images } : {}),
    ...(offer.categories?.length ? { category: offer.categories[0] } : {}),
    ...(booked
      ? { provider: { "@type": businessSchemaType(organization), name: organization.name } }
      : { brand: { "@type": "Brand", name: organization.name } }),
    offers: {
      "@type": "Offer",
      url,
      price: offer.pricing.amount,
      priceCurrency: offer.pricing.currency,
      availability: "https://schema.org/InStock",
      seller: { "@type": "Organization", name: organization.name },
    },
  };
}

/** Home › Catalogue › the offer: the trail Google prints above the result instead of a bare URL. */
export function offerBreadcrumbJsonLd(
  offer: PublicOffer,
  organization: PublicOrganization,
  siteUrl: string,
  catalogueLabel: string,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: organization.name, item: siteUrl },
      { "@type": "ListItem", position: 2, name: catalogueLabel, item: `${siteUrl}/catalogue` },
      { "@type": "ListItem", position: 3, name: offer.name, item: `${siteUrl}/offers/${offer.id}` },
    ],
  };
}

/** A data block, never executed; `<` escaped so a value cannot close the script element. */
export function jsonLdHtml(data: Record<string, unknown> | Record<string, unknown>[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
