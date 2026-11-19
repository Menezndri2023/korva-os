import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { BUSINESS_MODEL_OFFER_FIELDS, OFFER_FIELD_TEXT_EN, offerAttributeText } from "@korva/types";
import { StorefrontLocaleProvider } from "@/lib/storefront-locale";
import { OfferAttributes } from "./OfferAttributes";

describe("guided characteristics in English", () => {
  it("has the English of every guided label and option, of every trade", () => {
    const missing: string[] = [];
    for (const fields of Object.values(BUSINESS_MODEL_OFFER_FIELDS)) {
      for (const field of fields ?? []) {
        for (const text of [field.label, ...(field.options ?? [])]) {
          if (!OFFER_FIELD_TEXT_EN[text]) missing.push(text);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("translates a checklist option by option, and leaves the owner's own words alone", () => {
    expect(offerAttributeText("Allergènes", "Gluten, Œufs, Lait", "en")).toEqual({
      label: "Allergens",
      value: "Gluten, Eggs, Milk",
    });
    expect(offerAttributeText("Piment", "Très fort", "en")).toEqual({ label: "Spice", value: "Very hot" });
    // A free-text guided field keeps its value; a key the owner invented is shown as typed.
    expect(offerAttributeText("Portion", "Grande assiette", "en")).toEqual({ label: "Portion", value: "Grande assiette" });
    expect(offerAttributeText("Couleur", "Rouge", "en")).toEqual({ label: "Couleur", value: "Rouge" });
    expect(offerAttributeText("Allergènes", "Gluten, Œufs", "fr")).toEqual({ label: "Allergènes", value: "Gluten, Œufs" });
  });

  it("shows them on an English site, with a date written the English way", () => {
    render(
      <StorefrontLocaleProvider locale="en">
        <OfferAttributes attributes={{ Format: "En ligne", "Disponible à partir du": "2026-12-01" }} />
      </StorefrontLocaleProvider>,
    );
    expect(screen.getByText("Online")).toBeTruthy();
    expect(screen.getByText("Available from")).toBeTruthy();
    expect(screen.getByText("1 Dec 2026")).toBeTruthy();
  });
});
