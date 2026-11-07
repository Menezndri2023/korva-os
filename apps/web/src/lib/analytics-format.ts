import type { Locale } from "@korva/types";

export const LEAD_STATUS_LABELS: Record<string, string> = {
  new: "Nouveaux",
  contacted: "Contactés",
  qualified: "Qualifiés",
  disqualified: "Disqualifiés",
  converted: "Convertis",
};

export const DEAL_STATUS_LABELS: Record<string, string> = {
  open: "Ouvertes",
  won: "Gagnées",
  lost: "Perdues",
};

export const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  confirmed: "Confirmées",
  fulfilled: "Traitées",
  cancelled: "Annulées",
};

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  issued: "Émises",
  partially_paid: "Partiellement payées",
  paid: "Payées",
  overdue: "En retard",
  cancelled: "Annulées",
};

export const ACTIVITY_ENTITY_LABELS: Record<string, string> = {
  contact: "Contact",
  lead: "Prospect",
  booking: "Réservation",
  order: "Commande",
  invoice: "Facture",
  offer: "Offre",
  quote: "Devis",
  organization: "Organisation",
  subscription: "Abonnement",
  membership: "Membre de l'équipe",
  resource: "Ressource",
  workflow: "Automatisation",
  deal: "Affaire",
  ticket: "Ticket",
  campaign: "Campagne",
  conversation: "Conversation",
  message: "Message",
  payment: "Paiement",
  refund: "Remboursement",
  return_request: "Demande de retour",
  review: "Avis",
  user: "Compte",
  integration: "Intégration",
};

export const ACTIVITY_ACTION_LABELS: Record<string, string> = {
  CREATE: "créé",
  UPDATE: "mis à jour",
  DELETE: "supprimé",
  LOGIN: "connexion",
  LOGOUT: "déconnexion",
  PAYMENT: "paiement",
  REFUND: "remboursement",
  BOOKING: "réservation",
  AI_ACTION: "action IA",
  ROLE_CHANGE: "rôle modifié",
  SETTINGS_CHANGE: "paramètres modifiés",
};

export const LEAD_STATUS_LABELS_EN: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualified: "Qualified",
  disqualified: "Disqualified",
  converted: "Converted",
};

export const DEAL_STATUS_LABELS_EN: Record<string, string> = { open: "Open", won: "Won", lost: "Lost" };

export const ORDER_STATUS_LABELS_EN: Record<string, string> = {
  pending: "Pending",
  confirmed: "Confirmed",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

export const INVOICE_STATUS_LABELS_EN: Record<string, string> = {
  draft: "Draft",
  issued: "Issued",
  partially_paid: "Partly paid",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

export const ACTIVITY_ENTITY_LABELS_EN: Record<string, string> = {
  contact: "Contact",
  lead: "Lead",
  booking: "Booking",
  order: "Order",
  invoice: "Invoice",
  offer: "Offer",
  quote: "Quote",
  organization: "Organization",
  subscription: "Subscription",
  membership: "Team member",
  resource: "Resource",
  workflow: "Automation",
  deal: "Deal",
  ticket: "Ticket",
  campaign: "Campaign",
  conversation: "Conversation",
  message: "Message",
  payment: "Payment",
  refund: "Refund",
  return_request: "Return request",
  review: "Review",
  user: "Account",
  integration: "Integration",
};

const ACTIVITY_ACTION_LABELS_EN: Record<string, string> = {
  CREATE: "created",
  UPDATE: "updated",
  DELETE: "deleted",
  LOGIN: "sign-in",
  LOGOUT: "sign-out",
  PAYMENT: "payment",
  REFUND: "refund",
  BOOKING: "booking",
  AI_ACTION: "AI action",
  ROLE_CHANGE: "role changed",
  SETTINGS_CHANGE: "settings changed",
};

/** A label from a French table or its English twin; an unknown key shows as itself. */
export function labelIn(fr: Record<string, string>, en: Record<string, string>, key: string, locale: Locale): string {
  return (locale === "en" ? en[key] : fr[key]) ?? key;
}

/** Entities whose French label is feminine, so the past participle agrees: "Facture créée". */
const FEMININE_ENTITIES = new Set([
  "booking",
  "order",
  "invoice",
  "offer",
  "organization",
  "resource",
  "workflow",
  "deal",
  "campaign",
  "conversation",
  "return_request",
]);

const FEMININE_ACTION_LABELS: Record<string, string> = {
  CREATE: "créée",
  UPDATE: "mise à jour",
  DELETE: "supprimée",
};

/** "Facture créée", "Contact supprimé": entity label plus an agreeing action label. */
export function activityActionLabel(entity: string, action: string, locale: Locale = "fr"): string {
  // A payment "payment" or a refund "refund" repeated the noun: say what happened to it.
  if (entity === "payment" && action === "PAYMENT") return locale === "en" ? "received" : "reçu";
  if (entity === "refund" && action === "REFUND") return locale === "en" ? "made" : "effectué";
  if (entity === "payment" && action === "REFUND") return locale === "en" ? "refunded" : "remboursé";
  if (locale === "en") return ACTIVITY_ACTION_LABELS_EN[action] ?? action.toLowerCase();
  if (FEMININE_ENTITIES.has(entity) && FEMININE_ACTION_LABELS[action]) {
    return FEMININE_ACTION_LABELS[action];
  }
  return ACTIVITY_ACTION_LABELS[action] ?? action.toLowerCase();
}

export function formatCurrency(amount: number, currency: string | null, locale: Locale = "fr"): string {
  const intl = locale === "en" ? "en-GB" : "fr-FR";
  if (!currency) return amount.toLocaleString(intl);
  return new Intl.NumberFormat(intl, { style: "currency", currency }).format(amount);
}
