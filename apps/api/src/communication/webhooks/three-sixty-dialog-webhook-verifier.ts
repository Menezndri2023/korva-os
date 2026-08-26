import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WebhookVerifier } from '../../integrations/webhooks/webhook-verifier.interface';

/**
 * 360dialog's own webhook signature scheme — NOT Meta's `X-Hub-Signature-256` passthrough that
 * docs/decisions/whatsapp-provider.md's Wave 3 refinement pass assumed without re-verifying (that
 * section's own words: "not re-verified via new web research... confirm exact current header
 * names/algorithms against each provider's docs before implementing"). Re-verified for real while
 * building this Stage 2 lot (2026-08-26) against:
 *
 *   https://docs.360dialog.com/partner/onboarding/webhook-events-and-setup/signature-validation.md
 *
 * That page documents a scheme distinct from Meta's own:
 *   - header: `x-360dialog-signature`
 *   - algorithm: HMAC-SHA256 computed over the raw request body bytes
 *   - key: a "platform secret" generated in the 360dialog Hub — explicitly a *separate* secret
 *     from the `D360-API-KEY` used to send messages (`three-sixty-dialog.provider.ts`)
 *   - encoding: lowercase hex digest (360dialog's own reference implementation is Python's
 *     `hmac.new(...).hexdigest()` + `hmac.compare_digest(...)`, not base64 the way Svix/Resend's
 *     scheme works — see verify-svix-signature.ts for the contrast)
 *
 * This correction also makes architectural sense, not just doc sense: in the BSP model KORVA has
 * chosen, KORVA never holds a Meta App Secret at all — 360dialog is the Meta Tech Provider, not
 * KORVA (see docs/decisions/whatsapp-provider.md's multi-tenant-fit analysis) — so a
 * customer-facing Meta `X-Hub-Signature-256` passthrough KORVA could verify was never
 * architecturally possible to begin with; 360dialog necessarily re-signs with its own secret when
 * relaying events to a customer-configured webhook URL.
 *
 * Interestingly, Stage 1's `FakeWebhookVerifier`
 * (apps/api/src/integrations/webhooks/fake-webhook-verifier.ts) — "a fixed shared-secret header
 * must be present and match the configured secret exactly" — is structurally closer in spirit to
 * this real scheme (a shared secret configured out-of-band, not a value derived from a Meta App)
 * than the Meta-HMAC-over-App-Secret scheme the original decision record assumed, even though the
 * real 360dialog scheme is still a computed HMAC, not a bare string comparison.
 */
export class ThreeSixtyDialogWebhookVerifier implements WebhookVerifier {
  readonly provider = '360dialog';

  constructor(private readonly platformSecret: string) {}

  verify(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    if (!this.platformSecret) return false;

    const rawHeader = headers['x-360dialog-signature'];
    const provided = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
    if (!provided) return false;

    const expectedHex = createHmac('sha256', this.platformSecret)
      .update(rawBody)
      .digest('hex');

    let providedBuffer: Buffer;
    let expectedBuffer: Buffer;
    try {
      providedBuffer = Buffer.from(provided, 'hex');
      expectedBuffer = Buffer.from(expectedHex, 'hex');
    } catch {
      return false;
    }

    // timingSafeEqual throws on a length mismatch rather than returning false — the length check
    // must happen first, same guard verify-svix-signature.ts and fake-webhook-verifier.ts both use.
    // An empty buffer (e.g. an empty or entirely-non-hex header) is also rejected explicitly so a
    // pathological zero-length "match" can never occur.
    if (
      providedBuffer.length === 0 ||
      providedBuffer.length !== expectedBuffer.length
    ) {
      return false;
    }
    return timingSafeEqual(providedBuffer, expectedBuffer);
  }
}
