import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WebhookVerifier } from '../../../integrations/webhooks/webhook-verifier.interface';

/** GeniusPay's own example rejects a delivery older than this. */
export const GENIUSPAY_WEBHOOK_TOLERANCE_SECONDS = 300;

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * GeniusPay's webhook scheme (https://pay.genius.ci/doc, "Webhooks"):
 *   X-Webhook-Signature = hex HMAC-SHA256(timestamp + "." + payload, whsec_… secret)
 *   X-Webhook-Timestamp = Unix seconds
 * The secret is the webhook's own `whsec_…` (shown once, when the webhook is created), not the
 * API keys. Checked over the exact raw bytes received, as every verifier here (see
 * WebhookVerifier): GeniusPay's PHP sample re-encodes the parsed body, which signs the same bytes
 * for an ordinary payload. Even a rejected delivery loses nothing — payments are also settled by
 * the reconciliation sweep, which asks GeniusPay directly.
 */
export class GeniusPayWebhookVerifier implements WebhookVerifier {
  readonly provider = 'geniuspay';

  constructor(
    private readonly webhookSecret: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  verify(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    if (!this.webhookSecret) return false;
    const provided = header(headers, 'x-webhook-signature')?.trim();
    const timestamp = header(headers, 'x-webhook-timestamp')?.trim();
    if (!provided || !timestamp || !/^\d+$/.test(timestamp)) return false;
    const age = Math.abs(this.now() / 1000 - Number(timestamp));
    if (age > GENIUSPAY_WEBHOOK_TOLERANCE_SECONDS) return false;

    const expected = Buffer.from(
      createHmac('sha256', this.webhookSecret)
        .update(`${timestamp}.`)
        .update(rawBody)
        .digest('hex'),
      'utf8',
    );
    const candidate = Buffer.from(
      provided.replace(/^sha256=/, '').toLowerCase(),
      'utf8',
    );
    if (candidate.length !== expected.length) return false;
    return timingSafeEqual(candidate, expected);
  }
}
