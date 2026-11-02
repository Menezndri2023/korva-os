import type { Locale, OfferType } from "@korva/types";

// Same French labels as apps/web's dashboard/catalog pages (kept independent — apps/web is a
// different app this wave may not import from).
export const OFFER_TYPE_LABELS: Record<OfferType, string> = {
  product: "Produit",
  service: "Service",
  booking: "Réservation",
  digital_product: "Produit numérique",
  subscription: "Abonnement",
  package: "Forfait",
};

const OFFER_TYPE_LABELS_EN: Record<OfferType, string> = {
  product: "Product",
  service: "Service",
  booking: "Booking",
  digital_product: "Digital product",
  subscription: "Subscription",
  package: "Package",
};

export function offerTypeLabel(type: OfferType, locale: Locale): string {
  return (locale === "en" ? OFFER_TYPE_LABELS_EN : OFFER_TYPE_LABELS)[type];
}

export function formatOfferPrice(amount: number, currency: string, locale: Locale = "fr"): string {
  return new Intl.NumberFormat(locale === "en" ? "en-GB" : "fr-FR", { style: "currency", currency }).format(amount);
}
