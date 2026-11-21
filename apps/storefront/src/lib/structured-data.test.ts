import { describe, it, expect } from "vitest";
import type { PublicOffer, PublicOrganization } from "./public-types";
import {
  businessJsonLd,
  businessSchemaType,
  homeJsonLd,
  jsonLdHtml,
  offerBreadcrumbJsonLd,
  offerJsonLd,
  priceRange,
} from "./structured-data";

const salon = {
  name: "Salon Awa",
  businessModel: "appointments",
  currency: "XOF",
  contactPhone: "+225 07 00 00 00 00",
  contactAddress: "Cocody, Abidjan",
  reviewSummary: { average: 4.66, count: 12, latest: [] },
} as unknown as PublicOrganization;

describe("structured data", () => {
  it("describes the business with its trade's schema.org type, contact and rating", () => {
    expect(businessJsonLd(salon, "https://sites.korvasuite.com/salon-awa")).toMatchObject({
      "@type": "HealthAndBeautyBusiness",
      name: "Salon Awa",
      telephone: "+225 07 00 00 00 00",
      address: { streetAddress: "Cocody, Abidjan" },
      aggregateRating: { ratingValue: 4.7, reviewCount: 12 },
    });
  });

  it("gives a booked offer as a service and a product as a product, both with their price", () => {
    const booking = { type: "booking", name: "Tresses", images: [], pricing: { amount: 15000, currency: "XOF" } } as unknown as PublicOffer;
    const product = { ...booking, type: "product", name: "Pagne" } as PublicOffer;
    expect(offerJsonLd(booking, salon, "u")).toMatchObject({ "@type": "Service", offers: { price: 15000, priceCurrency: "XOF" } });
    expect(offerJsonLd(product, salon, "u")["@type"]).toBe("Product");
  });

  it("shows photos of the place before the logo, and nothing when there is no picture", () => {
    const pictured = { ...salon, logo: "logo.png", heroImage: "hero.jpg", heroSlides: ["s1.jpg"] } as PublicOrganization;
    expect(businessJsonLd(pictured, "u")).toMatchObject({ logo: "logo.png", image: ["hero.jpg", "s1.jpg", "logo.png"] });
    expect(businessJsonLd(salon, "u")).not.toHaveProperty("image");
  });

  it("files a known trade under its own schema.org category, else under its type of activity", () => {
    expect(businessSchemaType({ ...salon, type: "beauté" } as PublicOrganization)).toBe("BeautySalon");
    expect(businessSchemaType({ ...salon, type: "sport" } as PublicOrganization)).toBe("ExerciseGym");
    expect(businessSchemaType({ ...salon, type: "mode", businessModel: "retail" } as PublicOrganization)).toBe("ClothingStore");
    // A free-text type the owner typed themselves: the type of activity decides.
    expect(businessSchemaType({ ...salon, type: "Coiffure Awa" } as PublicOrganization)).toBe("HealthAndBeautyBusiness");
    expect(businessSchemaType({ name: "X" } as PublicOrganization)).toBe("LocalBusiness");
  });

  it("gives the address country only as a real ISO code", () => {
    expect(businessJsonLd({ ...salon, country: "ci" } as PublicOrganization, "u")).toMatchObject({
      address: { streetAddress: "Cocody, Abidjan", addressCountry: "CI" },
    });
    expect(businessJsonLd({ ...salon, country: "Côte d'Ivoire" } as PublicOrganization, "u").address).not.toHaveProperty("addressCountry");
  });

  it("lists what the business sells, with a price range", () => {
    const offers = [
      { id: "a", type: "booking", name: "Tresses", images: [], pricing: { amount: 15000, currency: "XOF" } },
      { id: "b", type: "product", name: "Mèches", images: [], pricing: { amount: 5000, currency: "XOF" } },
    ] as unknown as PublicOffer[];
    expect(priceRange(offers)).toBe("5 000 – 15 000 XOF");
    expect(priceRange([])).toBeUndefined();
    const data = businessJsonLd(salon, "https://s/salon-awa", offers);
    expect(data).toMatchObject({
      "@id": "https://s/salon-awa#business",
      priceRange: "5 000 – 15 000 XOF",
      hasOfferCatalog: {
        itemListElement: [
          { url: "https://s/salon-awa/offers/a", itemOffered: { "@type": "Service", name: "Tresses" } },
          { url: "https://s/salon-awa/offers/b", itemOffered: { "@type": "Product", name: "Mèches" } },
        ],
      },
    });
    expect(businessJsonLd(salon, "u")).not.toHaveProperty("hasOfferCatalog");
  });

  it("adds the business's own FAQ, skipping empty entries, and nothing when it wrote none", () => {
    const withFaq = {
      ...salon,
      faqItems: [
        { id: "1", question: "Livrez-vous ?", answer: "Oui, dans tout Abidjan." },
        { id: "2", question: " ", answer: "x" },
      ],
    } as PublicOrganization;
    const blocks = homeJsonLd(withFaq, "u");
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toMatchObject({
      "@type": "FAQPage",
      mainEntity: [{ name: "Livrez-vous ?", acceptedAnswer: { text: "Oui, dans tout Abidjan." } }],
    });
    expect(homeJsonLd(salon, "u")).toHaveLength(1);
  });

  it("gives an offer its breadcrumb trail", () => {
    const offer = { id: "a", name: "Tresses" } as PublicOffer;
    expect(offerBreadcrumbJsonLd(offer, salon, "https://s/salon-awa", "Catalogue")).toMatchObject({
      itemListElement: [
        { position: 1, name: "Salon Awa", item: "https://s/salon-awa" },
        { position: 2, item: "https://s/salon-awa/catalogue" },
        { position: 3, name: "Tresses", item: "https://s/salon-awa/offers/a" },
      ],
    });
  });

  it("can never close its script element", () => {
    expect(jsonLdHtml({ name: "</script><script>alert(1)</script>" })).not.toContain("</script>");
  });
});
