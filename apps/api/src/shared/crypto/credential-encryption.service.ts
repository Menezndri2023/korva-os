import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

/**
 * Encrypts/decrypts `IntegrationAccount.secretEncrypted` (see
 * docs/architecture/integrations-platform.md §3). Same AES-256-GCM algorithm and
 * `iv:authTag:ciphertext` hex encoding that `identity/auth/two-factor.service.ts` already proved
 * for TOTP secrets — deliberately copied rather than shared/imported, so this file has zero
 * dependency on identity/auth/** and two-factor.service.ts stays completely untouched.
 *
 * The one deliberate difference: the key is derived from its own dedicated env var,
 * `INTEGRATION_CREDENTIALS_KEY` (see core/config/env.validation.ts's REQUIRED_VARS), not
 * `JWT_SECRET`. Rotating `JWT_SECRET` (e.g. after an incident) must never silently corrupt every
 * stored PSP/WhatsApp credential platform-wide — a materially bigger blast radius than 2FA
 * secrets, which only affect login.
 */
@Injectable()
export class CredentialEncryptionService {
  private readonly encryptionKey: Buffer;

  constructor(private readonly configService: ConfigService) {
    const key = this.configService.getOrThrow<string>(
      'INTEGRATION_CREDENTIALS_KEY',
    );
    this.encryptionKey = createHash('sha256').update(key).digest();
  }

  /** `iv:authTag:ciphertext`, all hex — self-contained so `decrypt` needs nothing but the key. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
  }

  decrypt(payload: string): string {
    const [ivHex, authTagHex, ciphertextHex] = payload.split(':');
    if (!ivHex || !authTagHex || !ciphertextHex) {
      throw new Error('Malformed encrypted integration credential');
    }
    const decipher = createDecipheriv(
      ENCRYPTION_ALGORITHM,
      this.encryptionKey,
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextHex, 'hex')),
      decipher.final(),
    ]).toString('utf8');
  }
}
