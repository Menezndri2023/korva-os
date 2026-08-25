import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';
import * as OTPAuth from 'otpauth';
import { UsersService } from '../users/users.service';

const TOTP_ISSUER = 'KORVA OS';
const ENCRYPTION_ALGORITHM = 'aes-256-gcm';

/**
 * Encrypts/decrypts and verifies TOTP secrets. The AES-256-GCM key is derived from JWT_SECRET
 * (SHA-256 of it, giving exactly 32 bytes) rather than a brand-new env var — JWT_SECRET is
 * already a mandatory, server-only secret (see core/config/env.validation.ts, out of this
 * lot's ownership), so deriving from it keeps 2FA fully self-contained within
 * apps/api/src/identity/** without requiring any cross-agent env/config change. A dedicated key
 * would be marginally better hygiene, but this still means the secret is never recoverable from
 * anything short of the same JWT_SECRET that already guards every access token issued by this
 * API — a materially stronger bar than storing it in plaintext.
 */
@Injectable()
export class TwoFactorService {
  private readonly encryptionKey: Buffer;

  constructor(
    private readonly usersService: UsersService,
    private readonly configService: ConfigService,
  ) {
    const jwtSecret = this.configService.getOrThrow<string>('JWT_SECRET');
    this.encryptionKey = createHash('sha256').update(jwtSecret).digest();
  }

  /**
   * Starts (or restarts) enrollment: generates a fresh secret, stores it encrypted in the
   * *pending* slot only (2FA stays OFF until `confirm` succeeds), and returns the otpauth:// URI
   * so the caller can render a QR code, plus the raw base32 secret for manual entry — this is
   * the one and only time the plaintext secret is ever returned by the API.
   */
  async beginEnrollment(
    userId: string,
    email: string,
  ): Promise<{ secret: string; otpauthUrl: string }> {
    const totp = new OTPAuth.TOTP({
      issuer: TOTP_ISSUER,
      label: email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: new OTPAuth.Secret({ size: 20 }),
    });

    await this.usersService.setPendingTotpSecret(
      userId,
      this.encrypt(totp.secret.base32),
    );

    return { secret: totp.secret.base32, otpauthUrl: totp.toString() };
  }

  /** Confirms enrollment by checking `code` against the pending secret, then arms 2FA. */
  async confirmEnrollment(userId: string, code: string): Promise<void> {
    const user = await this.usersService.findByIdWithTotpSecret(userId);
    if (!user?.totpPendingSecretEncrypted) {
      throw new BadRequestException({
        code: 'TOTP_ENROLLMENT_NOT_STARTED',
        message: 'No pending 2FA enrollment for this account',
      });
    }
    if (user.totpEnabled) {
      throw new ConflictException({
        code: 'TOTP_ALREADY_ENABLED',
        message: '2FA is already enabled for this account',
      });
    }

    const secret = this.decrypt(user.totpPendingSecretEncrypted);
    if (!this.verifyCode(secret, code)) {
      throw new UnauthorizedException({
        code: 'INVALID_TOTP_CODE',
        message: 'Invalid verification code',
      });
    }

    await this.usersService.confirmTotpEnrollment(userId, this.encrypt(secret));
  }

  /** Disables 2FA, but only once `code` is verified against the currently-active secret. */
  async confirmDisable(userId: string, code: string): Promise<void> {
    const user = await this.usersService.findByIdWithTotpSecret(userId);
    if (!user?.totpEnabled || !user.totpSecretEncrypted) {
      throw new BadRequestException({
        code: 'TOTP_NOT_ENABLED',
        message: '2FA is not enabled for this account',
      });
    }
    if (!this.verifyCode(this.decrypt(user.totpSecretEncrypted), code)) {
      throw new UnauthorizedException({
        code: 'INVALID_TOTP_CODE',
        message: 'Invalid verification code',
      });
    }
    await this.usersService.disableTotp(userId);
  }

  /** Verifies a login-time code against the ACTIVE (confirmed) secret only. */
  verifyActiveCode(encryptedSecret: string, code: string): boolean {
    return this.verifyCode(this.decrypt(encryptedSecret), code);
  }

  private verifyCode(base32Secret: string, code: string): boolean {
    if (!/^\d{6}$/.test(code)) return false;
    const totp = new OTPAuth.TOTP({
      issuer: TOTP_ISSUER,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(base32Secret),
    });
    // window: 1 tolerates ±30s of clock drift between server and the user's authenticator app.
    return totp.validate({ token: code, window: 1 }) !== null;
  }

  /** `iv:authTag:ciphertext`, all hex — self-contained so `decrypt` needs nothing but the key. */
  private encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
  }

  private decrypt(payload: string): string {
    const [ivHex, authTagHex, ciphertextHex] = payload.split(':');
    if (!ivHex || !authTagHex || !ciphertextHex) {
      throw new Error('Malformed encrypted TOTP secret');
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
