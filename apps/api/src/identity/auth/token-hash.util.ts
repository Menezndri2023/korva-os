import { createHash } from 'node:crypto';

/** SHA-256 hash of an opaque bearer token (refresh token, password reset token, ...) — the only
 * form ever persisted to MongoDB; the plaintext token itself is never stored. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
