import { describe, expect, it } from "vitest";
import type { PublicOffer } from "@/lib/public-types";
import { filterListings, listingChoices, NO_LISTING_FILTERS, optionLabel, propertyFacts, roomFacts } from "./listing-facts";

function listing(id: string, amount: number, attributes: Record<string, string>): PublicOffer {
  return {
    id,
    type: "service",
    name: id,
    images: [],
    categories: [],
    pricing: { amount, currency: "XOF" },
    variants: [],
    attributes,
  };
}

const flat = listing("flat", 250_000, {
  Transaction: "Location",
  "Type de bien": "Appartement",
  "Surface (m²)": "85",
  Pièces: "3",
  Quartier: "Cocody",
  Ville: "Abidjan",
});
const villa = listing("villa", 150_000_000, {
  Transaction: "Vente",
  "Type de bien": "Villa",
  "Surface (m²)": "320",
  Quartier: "Riviera",
  Ville: "Abidjan",
});
const plot = listing("plot", 20_000_000, { Transaction: "Vente", "Type de bien": "Terrain", Ville: "Bingerville" });

describe("propertyFacts", () => {
  it("reads the guided fields an agency fills in", () => {
    expect(propertyFacts(flat)).toEqual({
      transaction: "rent",
      kind: "Appartement",
      surface: 85,
      rooms: 3,
      bedrooms: undefined,
      district: "Cocody",
      city: "Abidjan",
    });
  });
});

describe("filterListings", () => {
  const all = [flat, villa, plot];

  it("keeps everything without filters", () => {
    expect(filterListings(all, NO_LISTING_FILTERS)).toHaveLength(3);
  });

  it("narrows by transaction, type, place, price and surface", () => {
    const ids = (filters: Partial<typeof NO_LISTING_FILTERS>) =>
      filterListings(all, { ...NO_LISTING_FILTERS, ...filters }).map((o) => o.id);
    expect(ids({ transaction: "sale" })).toEqual(["villa", "plot"]);
    expect(ids({ kind: "Appartement" })).toEqual(["flat"]);
    expect(ids({ place: "Abidjan" })).toEqual(["flat", "villa"]);
    expect(ids({ place: "Cocody" })).toEqual(["flat"]);
    expect(ids({ maxPrice: 30_000_000 })).toEqual(["flat", "plot"]);
    // The plot's surface was never entered: a minimum surface leaves it out.
    expect(ids({ minSurface: 50 })).toEqual(["flat", "villa"]);
  });
});

describe("listingChoices", () => {
  it("offers only what the listings contain", () => {
    expect(listingChoices([flat, villa, plot])).toEqual({
      transactions: ["sale", "rent"],
      kinds: ["Appartement", "Terrain", "Villa"],
      places: ["Abidjan", "Bingerville", "Cocody", "Riviera"],
    });
  });
});

describe("roomFacts", () => {
  it("splits the amenities checklist and reads the capacity", () => {
    const room = { ...flat, attributes: { "Capacité (personnes)": "2", Lits: "1 lit double", Équipements: "Wi-Fi, Climatisation" } };
    expect(roomFacts(room)).toEqual({ guests: 2, beds: "1 lit double", surface: undefined, amenities: ["Wi-Fi", "Climatisation"] });
  });
});

describe("optionLabel", () => {
  it("translates stored French options on an English site only", () => {
    expect(optionLabel("Climatisation", "en")).toBe("Air conditioning");
    expect(optionLabel("Climatisation", "fr")).toBe("Climatisation");
    expect(optionLabel("Case en banco", "en")).toBe("Case en banco");
  });
});
