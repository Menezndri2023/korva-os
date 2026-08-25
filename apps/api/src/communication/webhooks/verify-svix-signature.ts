import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Resend signs its webhooks using Svix (https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests) —
 * the same scheme Svix's own SDKs implement, reproduced here directly (no `svix` npm dependency:
 * the algorithm is a few lines of HMAC-SHA256 and pulling in a whole SDK for it would be the
 * opposite of "minimum necessary change").
 *
 * Wire format:
 *   - secret: "whsec_<base64>" — the base64 part is the raw HMAC key.
 *   - headers: `svix-id`, `svix-timestamp` (unix seconds), `svix-signature` (one or more
 *     space-separated `v1,<base64 hmac>` tokens — multiple when a signing key was recently
 *     rotated and Svix is signing with both simultaneously).
 *   - signed content: `${svix-id}.${svix-timestamp}.${raw request body}` — the exact raw bytes
 *     Resend sent, not a re-serialization of the parsed JSON (see resend-webhook.controller.ts
 *     for why the raw bytes aren't wired up to the live route yet).
 */

export interface SvixHeaders {
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
}

const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

function decodeSecret(secret: string): Buffer {
  const withoutPrefix = secret.startsWith('whsec_')
    ? secret.slice('whsec_'.length)
    : secret;
  return Buffer.from(withoutPrefix, 'base64');
}

function computeExpectedSignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  payload: Buffer | string,
): Buffer {
  const signedContent = `${svixId}.${svixTimestamp}.${
    typeof payload === 'string' ? payload : payload.toString('utf8')
  }`;
  return createHmac('sha256', decodeSecret(secret))
    .update(signedContent, 'utf8')
    .digest();
}

/**
 * Constant-time comparison against every `v1,<sig>` token present (not just the first) — Svix
 * sends multiple during key rotation and any one of them being valid is sufficient.
 */
export function verifySvixSignature(
  payload: Buffer | string,
  headers: SvixHeaders,
  secret: string,
  options: { toleranceSeconds?: number; now?: () => number } = {},
): boolean {
  const { svixId, svixTimestamp, svixSignature } = headers;
  if (!svixId || !svixTimestamp || !svixSignature || !secret) {
    return false;
  }

  const timestampSeconds = Number(svixTimestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return false;
  }
  const toleranceSeconds =
    options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const nowSeconds = (options.now?.() ?? Date.now()) / 1000;
  if (Math.abs(nowSeconds - timestampSeconds) > toleranceSeconds) {
    return false;
  }

  const expected = computeExpectedSignature(
    secret,
    svixId,
    svixTimestamp,
    payload,
  );

  const candidates = svixSignature.split(' ').filter(Boolean);
  return candidates.some((candidate) => {
    const [version, encoded] = candidate.split(',');
    if (version !== 'v1' || !encoded) {
      return false;
    }
    let provided: Buffer;
    try {
      provided = Buffer.from(encoded, 'base64');
    } catch {
      return false;
    }
    if (provided.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(provided, expected);
  });
}
