import { createHmac } from 'node:crypto';

/** Header a receiver checks to verify a delivery genuinely came from KORVA — see signPayload. */
export const WEBHOOK_SIGNATURE_HEADER = 'X-Korva-Signature';
export const WEBHOOK_EVENT_HEADER = 'X-Korva-Event';

/**
 * HMAC-SHA256 over the exact raw JSON body bytes that get sent, using the subscription's own
 * secret — the receiver recomputes this over the raw body they received and compares, the
 * standard webhook-signing pattern (Stripe/GitHub/etc). Prefixed `sha256=` so the header is
 * self-describing if the scheme ever needs to change without breaking existing receivers.
 */
export function signPayload(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}
