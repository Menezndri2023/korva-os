import type { BusinessModel } from "@korva/types";
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

export function businessJsonLd(organization: PublicOrganization, url: string): Record<string, unknown> {
  const rating = organization.reviewSummary;
  return {
    "@context": "https://schema.org",
    "@type": organization.businessModel ? BUSINESS_TYPE[organization.businessModel] : "LocalBusiness",
    name: organization.name,
    url,
    ...(organization.tagline || organization.aboutText
      ? { description: organization.tagline || organization.aboutText }
      : {}),
    ...(organization.logo ? { logo: organization.logo, image: organization.logo } : {}),
    ...(organization.contactPhone || organization.whatsappNumber
      ? { telephone: organization.contactPhone || organization.whatsappNumber }
      : {}),
    ...(organization.contactAddress
      ? { address: { "@type": "PostalAddress", streetAddress: organization.contactAddress } }
      : {}),
    currenciesAccepted: organization.currency,
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

/** A product or, for something booked, a service — with its price, as search engines show it. */
export function offerJsonLd(
  offer: PublicOffer,
  organization: PublicOrganization,
  url: string,
): Record<string, unknown> {
  const booked = offer.type === "booking" || offer.type === "service";
  return {
    "@context": "https://schema.org",
    "@type": booked ? "Service" : "Product",
    name: offer.name,
    ...(offer.description ? { description: offer.description } : {}),
    ...(offer.images.length ? { image: offer.images } : {}),
    ...(booked
      ? { provider: { "@type": "LocalBusiness", name: organization.name } }
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

/** A data block, never executed; `<` escaped so a value cannot close the script element. */
export function jsonLdHtml(data: Record<string, unknown>): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
