import type { Locale } from "@korva/types";

/**
 * What a visitor reads when the API refuses something. The API answers in English for developers
 * ("Invalid email or password"); every form on a business's site used to print that sentence as
 * is. The code is the contract, so the wording for the visitor is chosen here, from the code.
 *
 * Only codes a visitor can actually meet on a site are listed; anything else reads as the
 * generic message — never as English.
 */
const MESSAGES = {
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
} satisfies Record<string, string>;

const MESSAGES_EN: Record<keyof typeof MESSAGES, string> = {
  INVALID_CREDENTIALS: "Incorrect e-mail address or password.",
  ACCOUNT_DISABLED: "Your account has been suspended by the business. Contact them to restore it.",
  ACCOUNT_LOCKED: "Too many sign-in attempts. Your account is locked for 15 minutes; try again after that.",
  EMAIL_TAKEN: "An account already exists with this e-mail address. Sign in or reset your password.",
  INVALID_RESET_TOKEN: "This reset link is no longer valid. Ask for a new one.",
  INVALID_REFRESH_TOKEN: "Your session has expired. Sign in again.",
  INVALID_CUSTOMER_TOKEN: "Your session has expired. Sign in again.",
  UNAUTHENTICATED: "Your session has expired. Sign in again.",
  NOT_AUTHENTICATED: "Sign in to continue.",
  CUSTOMER_NOT_FOUND: "Account not found.",
  PLAN_FEATURE_NOT_INCLUDED: "This website does not offer this service at the moment.",
  CART_EMPTY: "Your basket is empty.",
  INSUFFICIENT_STOCK: "An item in your basket is no longer available in that quantity.",
  OFFER_NOT_FOUND: "This offer is no longer available.",
  OFFER_VARIANT_NOT_FOUND: "This variant is no longer available.",
  VARIANT_NOT_FOUND: "This variant is no longer available.",
  DISCOUNT_CODE_NOT_FOUND: "This discount code does not exist.",
  DISCOUNT_CODE_EXHAUSTED: "This discount code is no longer valid.",
  DISCOUNT_CODE_INELIGIBLE: "This discount code does not apply to anything in your basket.",
  ONLINE_PAYMENT_NOT_AVAILABLE: "Online payment is not available here. Choose another payment method.",
  ORDER_ALREADY_PAID: "This order is already paid.",
  ORDER_NOT_PAYABLE: "This order can no longer be paid online.",
  ORDER_NOT_FOUND: "Order not found.",
  SLOT_REQUIRED: "Choose a time slot.",
  SLOT_UNAVAILABLE: "This slot has just been taken. Choose another one.",
  SLOT_BLOCKED: "This slot is not available. Choose another one.",
  OUTSIDE_AVAILABILITY_WINDOW: "This slot is outside opening hours.",
  NO_TABLE_AVAILABLE: "No table is free for this many people at this time. Try another time.",
  STAY_DATES_REQUIRED: "Choose an arrival date and a departure date.",
  STAY_TOO_SHORT: "A stay is at least one night.",
  STAY_BELOW_MINIMUM: "This stay needs a minimum number of nights.",
  NOT_A_STAY_OFFER: "This offer is not booked by the night.",
  RESOURCE_INACTIVE: "This can no longer be booked.",
  RESOURCE_NOT_FOUND: "This can no longer be booked.",
  BOOKING_NOT_FOUND: "Booking not found.",
  CERTIFICATE_NOT_AVAILABLE: "The certificate will be available once the session is over.",
  REVIEW_ALREADY_EXISTS: "You have already left a review for this purchase.",
  ORDER_NOT_REVIEWABLE: "You can leave a review once the order has been delivered.",
  BOOKING_NOT_REVIEWABLE: "You can leave a review once the appointment is over.",
  REVIEW_INVITATION_INVALID: "This review link is no longer valid.",
  RETURN_ORDER_NOT_FULFILLED: "A return is possible once the order has been delivered.",
  RETURN_QUANTITY_EXCEEDS_ORDERED: "This quantity is more than can still be returned.",
  RETURN_INVALID_LINE_ITEM: "This item is not part of the order.",
  QUOTE_INVALID_TRANSITION: "This quote can no longer be signed.",
  QUOTE_NOT_FOUND: "Quote not found.",
  INVOICE_NOT_FOUND: "The invoice is not available yet.",
  QUIZ_ANSWER_COUNT_MISMATCH: "Answer every question before sending.",
  NOT_ENROLLED_IN_COHORT: "You are not enrolled in this session.",
  DOWNLOAD_FAILED: "The document could not be downloaded. Try again in a moment.",
  ORGANIZATION_NOT_FOUND: "This website does not exist or is no longer online.",
  MODULE_NOT_AVAILABLE: "This service is not available on this website.",
  ORGANIZATION_SUSPENDED: "This website is temporarily unavailable.",
  VALIDATION_ERROR: "Some details are missing or incorrect. Check the form.",
  TOO_MANY_REQUESTS: "Too many attempts in a short time. Wait a minute and try again.",
  NETWORK_ERROR: "Cannot connect. Check your internet connection and try again.",
};

export const GENERIC_VISITOR_MESSAGE = "Une erreur est survenue. Réessayez dans un instant.";
const GENERIC_VISITOR_MESSAGE_EN = "Something went wrong. Try again in a moment.";

export function visitorMessage(code: string | undefined, locale: Locale = "fr"): string {
  const known = code && Object.hasOwn(MESSAGES, code) ? (code as keyof typeof MESSAGES) : undefined;
  if (locale === "en") return known ? MESSAGES_EN[known] : GENERIC_VISITOR_MESSAGE_EN;
  return known ? MESSAGES[known] : GENERIC_VISITOR_MESSAGE;
}
