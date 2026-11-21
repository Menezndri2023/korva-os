import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WebhookVerifier } from '../../../integrations/webhooks/webhook-verifier.interface';

/** SasPay's docs: reject a delivery whose timestamp is more than 5 minutes off. */
export const SASPAY_WEBHOOK_TOLERANCE_SECONDS = 300;

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * SasPay's webhook scheme (docs.saspay.me/api-reference/webhooks, "Sécurité"):
 *   X-Webhook-Signature = lowercase hex HMAC-SHA256(timestamp + "." + raw body, signing_secret)
 *   X-Webhook-Timestamp = Unix seconds, regenerated on every delivery attempt
 * The signing secret is shown ONCE, when the webhook is created or its secret changed in SasPay's
 * dashboard — it goes in SASPAY_WEBHOOK_SECRET. Checked over the exact bytes received.
 */
export class SasPayWebhookVerifier implements WebhookVerifier {
  readonly provider = 'saspay';

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
    if (age > SASPAY_WEBHOOK_TOLERANCE_SECONDS) return false;

    const expected = Buffer.from(
      createHmac('sha256', this.webhookSecret)
        .update(`${timestamp}.`)
        .update(rawBody)
        .digest('hex'),
      'utf8',
    );
    const candidate = Buffer.from(provided.toLowerCase(), 'utf8');
    if (candidate.length !== expected.length) return false;
    return timingSafeEqual(candidate, expected);
  }
}
