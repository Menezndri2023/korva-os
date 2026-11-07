import { ApiError } from "./api-client";

const MESSAGES: Record<string, [string, string]> = {
  GIFT_CARD_NOT_FOUND: ["Aucune carte cadeau avec ce code.", "No gift card with this code."],
  GIFT_CARD_DISABLED: ["Cette carte cadeau n'est plus valable.", "This gift card is no longer valid."],
  GIFT_CARD_EXPIRED: ["Cette carte cadeau a expiré.", "This gift card has expired."],
  GIFT_CARD_EMPTY: ["Cette carte cadeau a déjà été entièrement utilisée.", "This gift card has already been fully used."],
  GIFT_CARD_CURRENCY: ["Cette carte cadeau est dans une autre devise.", "This gift card is in another currency."],
  GIFT_CARD_NOTHING_TO_PAY: ["Il ne reste rien à payer sur cette facture.", "There is nothing left to pay on this invoice."],
  GIFT_CARD_NOT_USABLE: ["Cette carte ne peut pas payer ce montant.", "This card cannot pay this amount."],
};

/** A gift card refusal in the reader's words, or null for any other error. */
export function giftCardErrorText(error: unknown): [string, string] | null {
  return error instanceof ApiError ? (MESSAGES[error.code] ?? null) : null;
}
