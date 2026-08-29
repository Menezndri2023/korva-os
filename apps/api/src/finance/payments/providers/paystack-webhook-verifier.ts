import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WebhookVerifier } from '../../../integrations/webhooks/webhook-verifier.interface';

/**
 * Paystack's webhook authenticity scheme, per paystack.com/docs/payments/webhooks/ (confirmed via
 * live web search 2026-08-29, Paystack's own docs domain returns 403 to automated fetches so this
 * was cross-checked against multiple independent sources quoting the same scheme, not a single
 * unverified claim): a genuine HMAC, unlike Flutterwave's static `verif-hash` comparison (see
 * flutterwave-webhook-verifier.ts's own doc comment for that contrast) —
 *
 *   "Events sent from Paystack carry the `x-paystack-signature` header, a HMAC SHA512 signature
 *   of the event payload, signed using your secret key."
 *
 * This genuinely authenticates the BODY's integrity (not just the connection), computed over the
 * exact raw bytes Paystack sent — `rawBody` is used directly here, unlike
 * FlutterwaveWebhookVerifier where it's intentionally unused.
 *
 * Unlike Flutterwave (which issues a SEPARATE static "secret hash" specifically for webhooks,
 * independent of its API secret key), Paystack signs webhooks with the SAME secret key used to
 * authenticate API calls — there is no separate webhook-only credential in Paystack's model. This
 * verifier is constructed with whatever secret key PaystackWebhookController reads from
 * `PAYSTACK_SECRET_KEY` (see that controller's own doc comment for why this is a deliberate,
 * documented simplification: it assumes a single platform-wide Paystack secret, not a per-market
 * one, mirroring Flutterwave's own single-env-var posture).
 */
export class PaystackWebhookVerifier implements WebhookVerifier {
  readonly provider = 'paystack';

  constructor(private readonly secretKey: string) {}

  verify(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    if (!this.secretKey) return false;

    const rawHeader = headers['x-paystack-signature'];
    const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!provided) return false;

    const expectedHex = createHmac('sha512', this.secretKey)
      .update(rawBody)
      .digest('hex');
    const expected = Buffer.from(expectedHex, 'utf8');
    const candidate = Buffer.from(provided, 'utf8');
    // timingSafeEqual throws on a length mismatch rather than returning false — the length check
    // must happen first, same guard used in flutterwave-webhook-verifier.ts/verify-svix-signature.ts.
    if (candidate.length !== expected.length) return false;
    return timingSafeEqual(candidate, expected);
  }
}
