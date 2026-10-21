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
export function activityActionLabel(entity: string, action: string): string {
  if (FEMININE_ENTITIES.has(entity) && FEMININE_ACTION_LABELS[action]) {
    return FEMININE_ACTION_LABELS[action];
  }
  return ACTIVITY_ACTION_LABELS[action] ?? action.toLowerCase();
}

export function formatCurrency(amount: number, currency: string | null): string {
  if (!currency) return amount.toLocaleString("fr-FR");
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(amount);
}
