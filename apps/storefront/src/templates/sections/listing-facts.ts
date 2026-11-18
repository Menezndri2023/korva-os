import type { Locale } from "@korva/types";
import type { PublicOffer } from "@/lib/public-types";

/**
 * Reads the guided characteristics a guesthouse and an estate agency fill in
 * (BUSINESS_MODEL_OFFER_FIELDS in @korva/types). They are stored in Offer.attributes under their
 * French labels, so the "sejour" and "agence" templates read them here and phrase them in the
 * site's own language — the one place an English site does not show French keys.
 */

const VALUE_EN: Record<string, string> = {
  Vente: "For sale",
  Location: "To let",
  Appartement: "Apartment",
  Maison: "House",
  Villa: "Villa",
  Studio: "Studio",
  Terrain: "Land",
  Bureau: "Office",
  "Local commercial": "Commercial premises",
  "Wi-Fi": "Wi-Fi",
  Climatisation: "Air conditioning",
  Ventilateur: "Fan",
  "Salle de bain privée": "Private bathroom",
  Télévision: "TV",
  "Petit-déjeuner inclus": "Breakfast included",
  Parking: "Parking",
  Piscine: "Swimming pool",
  "Cuisine équipée": "Equipped kitchen",
};

/** A stored French option, in the site's language (unknown values are shown as typed). */
export function optionLabel(value: string, locale: Locale): string {
  return locale === "en" ? (VALUE_EN[value] ?? value) : value;
}

function attribute(offer: PublicOffer, label: string): string | undefined {
  const value = offer.attributes?.[label]?.trim();
  return value ? value : undefined;
}

function positiveNumber(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const n = Number(value.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export type Transaction = "sale" | "rent";

export interface PropertyFacts {
  transaction?: Transaction;
  /** As stored ("Appartement"…) — translate with optionLabel. */
  kind?: string;
  surface?: number;
  rooms?: number;
  bedrooms?: number;
  district?: string;
  city?: string;
}

export function propertyFacts(offer: PublicOffer): PropertyFacts {
  const transaction = attribute(offer, "Transaction");
  return {
    transaction: transaction === "Vente" ? "sale" : transaction === "Location" ? "rent" : undefined,
    kind: attribute(offer, "Type de bien"),
    surface: positiveNumber(attribute(offer, "Surface (m²)")),
    rooms: positiveNumber(attribute(offer, "Pièces")),
    bedrooms: positiveNumber(attribute(offer, "Chambres")),
    district: attribute(offer, "Quartier"),
    city: attribute(offer, "Ville"),
  };
}

/** "Cocody, Abidjan", or whichever of the two is known. */
export function placeOf(facts: Pick<PropertyFacts, "district" | "city">): string | undefined {
  return [facts.district, facts.city].filter(Boolean).join(", ") || undefined;
}

export interface ListingFilters {
  transaction: Transaction | "all";
  /** A stored "Type de bien" value, or "all". */
  kind: string;
  /** A district or city, or "all". */
  place: string;
  maxPrice?: number;
  minSurface?: number;
}

export const NO_LISTING_FILTERS: ListingFilters = { transaction: "all", kind: "all", place: "all" };

/**
 * A listing without the characteristic a filter asks about is left out once that filter is set:
 * a buyer asking for 80 m² is not shown a flat whose surface nobody entered.
 */
export function filterListings(offers: PublicOffer[], filters: ListingFilters): PublicOffer[] {
  return offers.filter((offer) => {
    const facts = propertyFacts(offer);
    if (filters.transaction !== "all" && facts.transaction !== filters.transaction) return false;
    if (filters.kind !== "all" && facts.kind !== filters.kind) return false;
    if (filters.place !== "all" && facts.district !== filters.place && facts.city !== filters.place) return false;
    if (filters.maxPrice != null && offer.pricing.amount > filters.maxPrice) return false;
    if (filters.minSurface != null && (facts.surface ?? 0) < filters.minSurface) return false;
    return true;
  });
}

/** The choices the filter bar offers: only what the agency's listings actually contain. */
export function listingChoices(offers: PublicOffer[]): {
  transactions: Transaction[];
  kinds: string[];
  places: string[];
} {
  const transactions = new Set<Transaction>();
  const kinds = new Set<string>();
  const places = new Set<string>();
  for (const offer of offers) {
    const facts = propertyFacts(offer);
    if (facts.transaction) transactions.add(facts.transaction);
    if (facts.kind) kinds.add(facts.kind);
    if (facts.district) places.add(facts.district);
    if (facts.city) places.add(facts.city);
  }
  const sort = (values: Set<string>) => [...values].sort((a, b) => a.localeCompare(b, "fr"));
  return {
    transactions: (["sale", "rent"] as const).filter((t) => transactions.has(t)),
    kinds: sort(kinds),
    places: sort(places),
  };
}

export interface RoomFacts {
  guests?: number;
  beds?: string;
  surface?: number;
  /** As stored — translate with optionLabel. */
  amenities: string[];
}

export function roomFacts(offer: PublicOffer): RoomFacts {
  return {
    guests: positiveNumber(attribute(offer, "Capacité (personnes)")),
    beds: attribute(offer, "Lits"),
    surface: positiveNumber(attribute(offer, "Superficie (m²)")),
    amenities: (attribute(offer, "Équipements") ?? "")
      .split(", ")
      .map((value) => value.trim())
      .filter(Boolean),
  };
}
