import { timingSafeEqual } from 'node:crypto';
import type { WebhookVerifier } from '../../../integrations/webhooks/webhook-verifier.interface';

/**
 * Flutterwave v3's webhook authenticity scheme, per
 * developer.flutterwave.com/v3.0.0/docs/webhooks.md and
 * developer.flutterwave.com/v3.0/docs/webhooks (both fetched 2026-08-26, current content
 * identical): NOT an HMAC signature over the request body — this was checked directly rather than
 * assumed, per this lot's own mandate. Flutterwave's real scheme is a static secret hash:
 *
 *   "If you specify a secret hash, we'll include it in our request to your webhook endpoint, in
 *   a header called `verif-hash`... check if the `verif-hash` header is present [and] matches the
 *   secret hash you set. If the header is missing, or the value doesn't match, you can discard
 *   the request, as it isn't from Flutterwave."
 *
 * Flutterwave's own Node.js example in that doc does a plain `signature !== secretHash` string
 * comparison. This implementation raises that to a constant-time comparison via `timingSafeEqual`
 * (never `===`), matching `verify-svix-signature.ts`'s own security posture, for the same reason
 * that file exists: a plain `===`/`!==` on a secret comparison leaks timing information an
 * attacker could use to guess the secret byte-by-byte.
 *
 * Note this scheme authenticates the CONNECTION (the shared secret itself, echoed back verbatim),
 * not the body's integrity the way an HMAC signature would — `rawBody` is intentionally unused
 * here, unlike `verifySvixSignature`'s body-derived HMAC. This is a real, documented difference
 * between Flutterwave's v3 scheme and Resend/Svix's, not an oversight: Flutterwave's own v4 API
 * docs (developer.flutterwave.com/docs/webhooks.md, fetched 2026-08-26) describe a newer
 * `flutterwave-signature` header that IS an HMAC-SHA256 over the raw body — but this adapter
 * targets v3 (see flutterwave-payment.provider.ts's class doc comment for why), so v3's
 * static-hash scheme is what's implemented here.
 */
export class FlutterwaveWebhookVerifier implements WebhookVerifier {
  readonly provider = 'flutterwave';

  constructor(private readonly secretHash: string) {}

  verify(
    _rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    if (!this.secretHash) return false;

    const rawHeader = headers['verif-hash'];
    const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!provided) return false;

    const expected = Buffer.from(this.secretHash, 'utf8');
    const candidate = Buffer.from(provided, 'utf8');
    // timingSafeEqual throws on a length mismatch rather than returning false — the length check
    // must happen first, same guard used in verify-svix-signature.ts and fake-webhook-verifier.ts.
    if (candidate.length !== expected.length) return false;
    return timingSafeEqual(candidate, expected);
  }
}
