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

export function formatCurrency(amount: number, currency: string | null): string {
  if (!currency) return amount.toLocaleString("fr-FR");
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(amount);
}
