import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from '../../communication/providers/email-provider.interface';
import { interpolate } from '../../shared/template';
import { UserDocument } from '../schemas/user.schema';
import { UsersRepository } from '../users/users.repository';
import { EmailVerificationRepository } from './email-verification.repository';
import { hashToken } from './token-hash.util';

const TOKEN_TTL_MS = 30 * 60 * 1000;

const VERIFICATION_EMAIL_SUBJECT = 'Verify your KORVA OS email address';

/** `{{verificationUrl}}` only — deliberately no other placeholder, so nothing that could ever
 * carry user-supplied content reaches this template. escapeHtml is still enabled for defense in
 * depth even though verificationUrl is built entirely from a server-generated hex token. */
const VERIFICATION_EMAIL_BODY_TEMPLATE =
  '<p>Please confirm your email address for your KORVA OS account.</p>' +
  '<p><a href="{{verificationUrl}}">Click here to verify your email</a>. This link expires in 30 minutes.</p>' +
  '<p>If you did not create this account, you can safely ignore this email.</p>';

/**
 * Informative, non-blocking email verification: this service only issues/consumes tokens and
 * flips User.emailVerifiedAt — it never gates login or any other route on the result. Whether
 * verification should ever become mandatory is a separate product decision, deliberately out of
 * scope here (see the pre-implementation audit for this lot).
 *
 * Deliberately a separate token collection/repository from PasswordResetRepository (same
 * pattern, not the same storage) — coupling two different sensitive operations onto one
 * collection would let a bug in one silently affect the other. Injects UsersRepository directly
 * (not UsersService) purely to keep this lot's file footprint within its explicitly authorized
 * scope — every other consumer of Users in this module goes through UsersService; this is a
 * deliberate, documented deviation, not an oversight.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly emailVerificationRepository: EmailVerificationRepository,
    private readonly configService: ConfigService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  /**
   * Fire-and-forget from the caller's perspective: a delivery failure is logged (never the
   * token itself) and never propagated — same posture as PasswordResetService.forgotPassword's
   * email send and EventBusService.publish(). Never throws.
   */
  async sendVerification(user: UserDocument): Promise<void> {
    const token = randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await this.emailVerificationRepository.issue(
      user._id,
      tokenHash,
      expiresAt,
    );

    const verificationUrl = this.buildVerificationUrl(token);
    const body = interpolate(
      VERIFICATION_EMAIL_BODY_TEMPLATE,
      { verificationUrl },
      { escapeHtml: true },
    );

    try {
      await this.emailProvider.send({
        to: user.email,
        subject: VERIFICATION_EMAIL_SUBJECT,
        body,
      });
    } catch (error) {
      this.logger.error('Failed to send email verification message', error);
    }
  }

  /**
   * The token itself is the only proof of possession required — no userId is ever accepted
   * from the caller. A missing/expired/already-used token is never distinguished from another:
   * the same generic error covers all three (see EmailVerificationRepository.consume's atomic
   * filter, mirroring PasswordResetRepository.consume).
   */
  async verify(token: string): Promise<void> {
    const tokenHash = hashToken(token);
    const claim = await this.emailVerificationRepository.consume(tokenHash);
    if (!claim) {
      throw new UnauthorizedException({
        code: 'INVALID_VERIFICATION_TOKEN',
        message: 'This verification link is invalid or has expired',
      });
    }

    await this.usersRepository.markEmailVerified(claim.userId.toString());
  }

  private buildVerificationUrl(token: string): string {
    const appUrl =
      this.configService.get<string>('APP_URL') ?? 'http://localhost:3000';
    return `${appUrl}/verify-email?token=${token}`;
  }
}
