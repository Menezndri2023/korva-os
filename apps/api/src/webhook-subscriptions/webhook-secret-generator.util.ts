import { randomBytes } from 'node:crypto';

/** Greppable prefix so a leaked signing secret is identifiable in logs/secret scanners at a glance. */
export const WEBHOOK_SECRET_PREFIX = 'whsec_';

/**
 * 32 bytes (256 bits) of CSPRNG entropy, base64url-encoded, behind `WEBHOOK_SECRET_PREFIX` — same
 * entropy/encoding as api-key-generator.util.ts's `generateApiKey`. Unlike an API key, this secret
 * must be readable again (to HMAC-sign every delivery), so the caller encrypts `plaintext` with
 * CredentialEncryptionService rather than hashing it — see WebhookSubscriptionsService.create.
 */
export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}
