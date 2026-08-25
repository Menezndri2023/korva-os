import { randomBytes } from 'node:crypto';
import { hashToken } from '../auth/token-hash.util';

/** Greppable prefix so a leaked key is identifiable in logs/secret scanners at a glance. */
export const API_KEY_PREFIX = 'korva_live_';

/** How much of the plaintext is retained as `keyPrefix` for display in listings — long enough
 *  to tell two keys apart, short enough that it carries no meaningful entropy on its own. */
const DISPLAY_PREFIX_LENGTH = API_KEY_PREFIX.length + 8;

export interface GeneratedApiKey {
  /** Returned to the caller exactly once — never persisted. */
  plaintext: string;
  /** The only form ever written to MongoDB (see ApiKey.keyHash). */
  hash: string;
  /** Safe to store and display — see ApiKey.keyPrefix's class doc. */
  displayPrefix: string;
}

/**
 * 32 bytes (256 bits) of CSPRNG entropy, base64url-encoded, behind `API_KEY_PREFIX`. Hashed with
 * the same SHA-256 scheme already used for every other bearer secret in this codebase (refresh
 * tokens, password-reset tokens, invitation tokens — see token-hash.util.ts) before it is ever
 * persisted.
 */
export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(32).toString('base64url');
  const plaintext = `${API_KEY_PREFIX}${secret}`;
  return {
    plaintext,
    hash: hashToken(plaintext),
    displayPrefix: plaintext.slice(0, DISPLAY_PREFIX_LENGTH),
  };
}
