import { timingSafeEqual } from 'node:crypto';
import type { WebhookVerifier } from './webhook-verifier.interface';

/**
 * TEST / DEV SUPPORT ONLY — NOT a real provider signature scheme.
 *
 * Stage 1 of the integrations platform (see docs/architecture/integrations-platform.md §8,
 * FOUND-WEBHOOK) has no real Flutterwave/360dialog verifier yet — those are Stage 2, explicitly
 * out of scope here. This fake exists solely so integration-webhook.service.spec.ts (and any
 * other Stage 1 test) can exercise the generic pipeline's verify → idempotency-check → publish
 * contract end to end without a real provider's HMAC/signature algorithm.
 *
 * Scheme (deliberately trivial, not modeled on any real provider): a fixed shared-secret header
 * (`x-webhook-secret` by default) must be present and match the configured secret exactly. The
 * comparison itself is still written constant-time — not because this fake's own security matters
 * (it's never wired into a real route), but so tests exercising it also incidentally guard the
 * same constant-time-comparison property a real verifier must have.
 */
export class FakeWebhookVerifier implements WebhookVerifier {
  readonly provider: string;

  constructor(
    provider: string,
    private readonly sharedSecret: string,
    private readonly headerName: string = 'x-webhook-secret',
  ) {
    this.provider = provider;
  }

  verify(
    _rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    const rawHeader = headers[this.headerName];
    const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!provided) return false;

    const expected = Buffer.from(this.sharedSecret, 'utf8');
    const candidate = Buffer.from(provided, 'utf8');
    // timingSafeEqual throws on a length mismatch rather than returning false — the length
    // check must happen first, same guard used in verify-svix-signature.ts.
    if (candidate.length !== expected.length) return false;
    return timingSafeEqual(candidate, expected);
  }
}
