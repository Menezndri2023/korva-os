import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ReviewEntity } from '@korva/types';
import { REVIEW_ENTITIES } from '@korva/types';

/**
 * The link a customer receives after a delivered order or a completed booking: "Donnez votre
 * avis". Most customers buy as guests, so the link itself must prove the purchase — no account,
 * no stored invitation. It is a signed statement "this contact may review this order of this
 * business", valid for INVITATION_TTL_MS.
 *
 * Signed with a key DERIVED from JWT_SECRET (never JWT_SECRET itself), so a review token can
 * never be replayed as any other kind of token and rotating JWT_SECRET simply expires them. One
 * review per (contact, order) is still enforced by the reviews collection's unique index, so a
 * link used twice is refused the second time.
 */
export const INVITATION_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const KEY_LABEL = 'korva-review-invitation-v1';

export interface ReviewInvitationClaims {
  organizationId: string;
  entity: ReviewEntity;
  entityId: string;
  contactId: string;
  expiresAt: number;
}

function key(secret: string): Buffer {
  return createHmac('sha256', secret).update(KEY_LABEL).digest();
}

function sign(secret: string, body: string): string {
  return createHmac('sha256', key(secret)).update(body).digest('base64url');
}

export function signReviewInvitation(
  secret: string,
  claims: Omit<ReviewInvitationClaims, 'expiresAt'>,
  now = Date.now(),
): string {
  const body = Buffer.from(
    JSON.stringify({
      o: claims.organizationId,
      e: claims.entity,
      i: claims.entityId,
      c: claims.contactId,
      x: now + INVITATION_TTL_MS,
    }),
  ).toString('base64url');
  return `${body}.${sign(secret, body)}`;
}

/** Null for anything forged, truncated, malformed or expired — callers answer all of them the
 *  same way, so a probe learns nothing about which part was wrong. */
export function verifyReviewInvitation(
  secret: string,
  token: string,
  now = Date.now(),
): ReviewInvitationClaims | null {
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const { o, e, i, c, x } = (raw ?? {}) as Record<string, unknown>;
  const isId = (value: unknown): value is string =>
    typeof value === 'string' && /^[0-9a-f]{24}$/.test(value);
  if (
    !isId(o) ||
    !isId(i) ||
    !isId(c) ||
    typeof x !== 'number' ||
    !(REVIEW_ENTITIES as readonly unknown[]).includes(e)
  ) {
    return null;
  }
  if (x <= now) return null;
  return {
    organizationId: o,
    entity: e as ReviewEntity,
    entityId: i,
    contactId: c,
    expiresAt: x,
  };
}
