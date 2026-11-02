import type { Offer, OfferType } from "@korva/types";

/** An offer's type and status as owners read them, in French and English. */
export const OFFER_TYPE_LABELS: Record<OfferType, [string, string]> = {
  product: ["Produit", "Product"],
  service: ["Service", "Service"],
  booking: ["Réservation", "Booking"],
  digital_product: ["Produit numérique", "Digital product"],
  subscription: ["Abonnement", "Subscription"],
  package: ["Forfait", "Package"],
};

/** "En ligne" is the one that matters: only those offers appear on the public site. */
export const OFFER_STATUS_LABELS: Record<Offer["status"], [string, string]> = {
  draft: ["Brouillon", "Draft"],
  active: ["En ligne", "Online"],
  archived: ["Archivée", "Archived"],
};
