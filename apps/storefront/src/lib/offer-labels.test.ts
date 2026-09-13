import { describe, expect, it } from "vitest";
import { formatOfferPrice, OFFER_TYPE_LABELS } from "./offer-labels";

describe("OFFER_TYPE_LABELS", () => {
  it("has a French label for every OfferType", () => {
    expect(OFFER_TYPE_LABELS).toEqual({
      product: "Produit",
      service: "Service",
      booking: "Réservation",
      digital_product: "Produit numérique",
      subscription: "Abonnement",
      package: "Forfait",
    });
  });
});

// Intl.NumberFormat's fr-FR output uses a narrow no-break space (U+202F) between the amount and
// the currency symbol, not a regular space — normalized away here so assertions stay readable
// and don't depend on which no-break-space variant a given Node/ICU version emits.
function normalizeSpaces(value: string): string {
  return value.replace(/[\s  ]+/g, " ");
}

describe("formatOfferPrice", () => {
  it("formats EUR amounts with the French locale", () => {
    expect(normalizeSpaces(formatOfferPrice(19.9, "EUR"))).toBe("19,90 €");
  });

  it("formats whole amounts with two decimal places", () => {
    expect(normalizeSpaces(formatOfferPrice(100, "USD"))).toBe("100,00 $US");
  });

  it("formats zero", () => {
    expect(normalizeSpaces(formatOfferPrice(0, "EUR"))).toBe("0,00 €");
  });
});
