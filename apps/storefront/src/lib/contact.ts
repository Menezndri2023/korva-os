/**
 * A wa.me link to the shop's WhatsApp, optionally with the first message already typed.
 *
 * Organization.whatsappNumber is validated as international ("+225 07 07 07 07 07"); wa.me wants
 * the same digits with no "+" and no spaces.
 */
export function whatsappLink(number: string, message?: string): string {
  const digits = number.replace(/\D/g, "");
  return `https://wa.me/${digits}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
}

/** "+225 07 07 07 07 07" → "tel:+2250707070707". */
export function telLink(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}
