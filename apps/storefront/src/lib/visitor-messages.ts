/**
 * What a visitor reads when the API refuses something. The API answers in English for developers
 * ("Invalid email or password"); every form on a business's site used to print that sentence as
 * is. The code is the contract, so the wording for the visitor is chosen here, from the code.
 *
 * Only codes a visitor can actually meet on a site are listed; anything else reads as the
 * generic message — never as English.
 */
const MESSAGES: Record<string, string> = {
  // Customer account
  INVALID_CREDENTIALS: "Adresse e-mail ou mot de passe incorrect.",
  ACCOUNT_DISABLED: "Votre compte a été suspendu par l'établissement. Contactez-le pour le rétablir.",
  ACCOUNT_LOCKED:
    "Trop de tentatives de connexion. Votre compte est bloqué pendant 15 minutes, réessayez ensuite.",
  EMAIL_TAKEN: "Un compte existe déjà avec cette adresse e-mail. Connectez-vous ou réinitialisez votre mot de passe.",
  INVALID_RESET_TOKEN: "Ce lien de réinitialisation n'est plus valide. Demandez-en un nouveau.",
  INVALID_REFRESH_TOKEN: "Votre session a expiré. Reconnectez-vous.",
  INVALID_CUSTOMER_TOKEN: "Votre session a expiré. Reconnectez-vous.",
  UNAUTHENTICATED: "Votre session a expiré. Reconnectez-vous.",
  NOT_AUTHENTICATED: "Connectez-vous pour continuer.",
  CUSTOMER_NOT_FOUND: "Compte introuvable.",
  PLAN_FEATURE_NOT_INCLUDED: "Ce service n'est pas proposé par ce site pour le moment.",

  // Ordering
  CART_EMPTY: "Votre panier est vide.",
  INSUFFICIENT_STOCK: "Un article de votre panier n'est plus disponible en quantité suffisante.",
  OFFER_NOT_FOUND: "Cette offre n'est plus disponible.",
  OFFER_VARIANT_NOT_FOUND: "Cette variante n'est plus disponible.",
  VARIANT_NOT_FOUND: "Cette variante n'est plus disponible.",
  DISCOUNT_CODE_NOT_FOUND: "Ce code promo n'existe pas.",
  DISCOUNT_CODE_EXHAUSTED: "Ce code promo n'est plus valable.",
  DISCOUNT_CODE_INELIGIBLE: "Ce code promo ne s'applique à aucun article de votre panier.",
  ONLINE_PAYMENT_NOT_AVAILABLE: "Le paiement en ligne n'est pas disponible ici. Choisissez un autre moyen de paiement.",
  ORDER_ALREADY_PAID: "Cette commande est déjà payée.",
  ORDER_NOT_PAYABLE: "Cette commande ne peut plus être payée en ligne.",
  ORDER_NOT_FOUND: "Commande introuvable.",

  // Booking
  SLOT_REQUIRED: "Choisissez un créneau.",
  SLOT_UNAVAILABLE: "Ce créneau vient d'être pris. Choisissez-en un autre.",
  SLOT_BLOCKED: "Ce créneau n'est pas disponible. Choisissez-en un autre.",
  OUTSIDE_AVAILABILITY_WINDOW: "Ce créneau est en dehors des horaires d'ouverture.",
  NO_TABLE_AVAILABLE: "Plus de table libre pour ce nombre de personnes à cette heure. Essayez un autre horaire.",
  STAY_DATES_REQUIRED: "Choisissez une date d'arrivée et une date de départ.",
  STAY_TOO_SHORT: "Un séjour compte au moins une nuit.",
  STAY_BELOW_MINIMUM: "Ce séjour demande un nombre minimum de nuits.",
  NOT_A_STAY_OFFER: "Cette offre ne se réserve pas à la nuit.",
  RESOURCE_INACTIVE: "Cette ressource n'est plus réservable.",
  RESOURCE_NOT_FOUND: "Cette ressource n'est plus réservable.",
  BOOKING_NOT_FOUND: "Réservation introuvable.",
  CERTIFICATE_NOT_AVAILABLE: "L'attestation sera disponible une fois la séance terminée.",

  // Account area actions
  REVIEW_ALREADY_EXISTS: "Vous avez déjà laissé un avis pour cet achat.",
  ORDER_NOT_REVIEWABLE: "Vous pourrez laisser un avis une fois la commande livrée.",
  BOOKING_NOT_REVIEWABLE: "Vous pourrez laisser un avis une fois le rendez-vous terminé.",
  REVIEW_INVITATION_INVALID: "Ce lien d'avis n'est plus valide.",
  RETURN_ORDER_NOT_FULFILLED: "Un retour est possible une fois la commande livrée.",
  RETURN_QUANTITY_EXCEEDS_ORDERED: "Cette quantité dépasse ce qui peut encore être retourné.",
  RETURN_INVALID_LINE_ITEM: "Cet article ne fait pas partie de la commande.",
  QUOTE_INVALID_TRANSITION: "Ce devis ne peut plus être signé.",
  QUOTE_NOT_FOUND: "Devis introuvable.",
  INVOICE_NOT_FOUND: "La facture n'est pas encore disponible.",
  QUIZ_ANSWER_COUNT_MISMATCH: "Répondez à toutes les questions avant d'envoyer.",
  NOT_ENROLLED_IN_COHORT: "Vous n'êtes pas inscrit à cette session.",

  DOWNLOAD_FAILED: "Impossible de télécharger le document. Réessayez dans un instant.",

  // Site state and transport
  ORGANIZATION_NOT_FOUND: "Ce site n'existe pas ou n'est plus en ligne.",
  MODULE_NOT_AVAILABLE: "Ce service n'est pas disponible sur ce site.",
  ORGANIZATION_SUSPENDED: "Ce site est momentanément indisponible.",
  VALIDATION_ERROR: "Certaines informations sont manquantes ou incorrectes. Vérifiez le formulaire.",
  TOO_MANY_REQUESTS: "Trop de tentatives en peu de temps. Patientez une minute puis réessayez.",
  NETWORK_ERROR: "Connexion impossible. Vérifiez votre connexion internet et réessayez.",
};

export const GENERIC_VISITOR_MESSAGE = "Une erreur est survenue. Réessayez dans un instant.";

export function visitorMessage(code: string | undefined): string {
  return (code && MESSAGES[code]) || GENERIC_VISITOR_MESSAGE;
}
