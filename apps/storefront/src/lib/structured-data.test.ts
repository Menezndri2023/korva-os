import { describe, it, expect } from "vitest";
import type { PublicOffer, PublicOrganization } from "./public-types";
import { businessJsonLd, jsonLdHtml, offerJsonLd } from "./structured-data";

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

  it("can never close its script element", () => {
    expect(jsonLdHtml({ name: "</script><script>alert(1)</script>" })).not.toContain("</script>");
  });
});
