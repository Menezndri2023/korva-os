import { describe, expect, it } from "vitest";
import type { PublicOffer, PublicOrganization } from "./public-types";
import { siteLlmsText } from "./site-llms";

const salon = {
  name: "Salon Awa",
  type: "beauté",
  businessModel: "appointments",
  language: "fr",
  tagline: "Tresses et soins à Cocody",
  contactAddress: "Cocody, Abidjan",
  contactPhone: "+225 07 00 00 00 00",
  visibleSections: ["catalog", "booking"],
  reviewSummary: { average: 4.66, count: 12, latest: [] },
  faqItems: [{ id: "1", question: "Sans rendez-vous ?", answer: "Oui, le samedi." }],
} as unknown as PublicOrganization;

const offers = [
  { id: "a", type: "booking", name: "Tresses", description: "Deux heures.", images: [], pricing: { amount: 15000, currency: "XOF" } },
  { id: "b", type: "product", name: "Don libre", images: [], pricing: { amount: 0, currency: "XOF" } },
] as unknown as PublicOffer[];

describe("a business's llms.txt", () => {
  it("says who, where, what at what price, and the business's own answers", () => {
    const text = siteLlmsText(salon, offers, "https://sites.korvasuite.com/salon-awa");
    expect(text).toContain("# Salon Awa");
    expect(text).toContain("> Tresses et soins à Cocody");
    expect(text).toContain("- Activité : Salon & bien-être");
    expect(text).toContain("- Adresse : Cocody, Abidjan");
    expect(text).toContain("- Avis clients : 4.7/5 (12 avis)");
    expect(text).toContain("- [Tresses](https://sites.korvasuite.com/salon-awa/offers/a) : 15 000 XOF — Deux heures.");
    // A free amount has no price to state.
    expect(text).toContain("- [Don libre](https://sites.korvasuite.com/salon-awa/offers/b)\n");
    expect(text).toContain("- Sans rendez-vous ? Oui, le samedi.");
    expect(text).toContain("KORVA OS");
  });

  it("speaks the site's language", () => {
    const text = siteLlmsText({ ...salon, language: "en" } as PublicOrganization, [], "u");
    expect(text).toContain("- Business : Salon & wellness");
    expect(text).not.toContain("## Offers");
  });
});
