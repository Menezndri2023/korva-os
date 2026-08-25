import type { OfferType } from "@korva/types";

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

export function formatOfferPrice(amount: number, currency: string): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(amount);
}
