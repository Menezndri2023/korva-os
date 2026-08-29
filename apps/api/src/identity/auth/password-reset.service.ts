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
import { UsersService } from '../users/users.service';
import { SessionsService } from './sessions.service';
import { PasswordResetRepository } from './password-reset.repository';
import { hashToken } from './token-hash.util';

const TOKEN_TTL_MS = 30 * 60 * 1000;

/** Generic, identical response for every forgot-password call — see PasswordResetService.forgotPassword. */
const FORGOT_PASSWORD_RESPONSE = {
  message: 'If an account exists for this email, a reset link has been sent.',
};

const RESET_EMAIL_SUBJECT = 'Reset your KORVA OS password';

/** `{{resetUrl}}` only — deliberately no other placeholder, so nothing that could ever carry
 * user-supplied content reaches this template. escapeHtml is still enabled for defense in
 * depth even though resetUrl is built entirely from a server-generated hex token. */
const RESET_EMAIL_BODY_TEMPLATE =
  '<p>We received a request to reset your KORVA OS password.</p>' +
  '<p><a href="{{resetUrl}}">Click here to reset your password</a>. This link expires in 30 minutes.</p>' +
  '<p>If you did not request this, you can safely ignore this email.</p>';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly sessionsService: SessionsService,
    private readonly passwordResetRepository: PasswordResetRepository,
    private readonly configService: ConfigService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  /**
   * Never reveals whether `email` belongs to an existing account: same response, same shape,
   * regardless of the branch taken below. The one thing this cannot equalize without added
   * complexity out of scope for this lot is wall-clock timing (the "existing user" branch does
   * real hashing/DB/email work, the other does none) — a residual, documented risk, not a hidden
   * one (see docs/PRODUCTION_READINESS.md-style risk acceptance elsewhere in this codebase).
   */
  async forgotPassword(
    email: string,
  ): Promise<typeof FORGOT_PASSWORD_RESPONSE> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      return FORGOT_PASSWORD_RESPONSE;
    }

    const token = randomBytes(32).toString('hex');
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await this.passwordResetRepository.issue(user._id, tokenHash, expiresAt);

    const resetUrl = this.buildResetUrl(token);
    const body = interpolate(
      RESET_EMAIL_BODY_TEMPLATE,
      { resetUrl },
      { escapeHtml: true },
    );

    try {
      await this.emailProvider.send({
        to: user.email,
        subject: RESET_EMAIL_SUBJECT,
        body,
      });
    } catch (error) {
      // Same posture as EventBusService.publish() / WorkflowActionsService: a delivery failure
      // must never turn into a distinguishable response for the caller, and must never surface
      // the token itself — only that *something* about the send failed.
      this.logger.error('Failed to send password reset email', error);
    }

    return FORGOT_PASSWORD_RESPONSE;
  }

  /**
   * Ordering is deliberate and load-bearing:
   *   1. hash the new password (pure computation, no I/O, effectively cannot fail independently
   *      of a process-level crash) — BEFORE anything is consumed or written;
   *   2. atomically consume the token — the single validity gate; a failed/expired/already-used
   *      token throws here, before the User document is ever touched (no password change is
   *      possible on an invalid token);
   *   3. persist the already-computed hash, then revoke sessions.
   * This guarantees the two failure modes explicitly ruled out cannot both happen: the password
   * is never changed on an invalid token (step 2 gates step 3), and the token is never consumed
   * before the hash is known-good (step 1 happens first). The one residual risk that CANNOT be
   * removed without a multi-document Mongo transaction (deliberately out of scope for this lot,
   * see Lot T design decision) is a bare-Mongo failure of step 3 itself, after step 2 already
   * committed: the token would be burned with the password left unchanged. This is a narrow
   * window (a plain `updateOne` against the same already-reachable MongoDB instance that step 2
   * just wrote to), self-healing (the user can request a new reset token), and consistent with
   * this codebase's existing risk posture elsewhere (e.g. AuthService.detectRefreshTokenReuse's
   * documented false-positive, EventBusService.publish's log-don't-throw stance).
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const tokenHash = hashToken(token);
    const newPasswordHash = await this.usersService.hashPassword(newPassword);

    const claim = await this.passwordResetRepository.consume(tokenHash);
    if (!claim) {
      // Same status/shape family as AuthService.refresh's INVALID_REFRESH_TOKEN — this token is
      // conceptually the same kind of thing (an opaque bearer credential that's invalid,
      // expired, or already used), never distinguished from one another in the response.
      throw new UnauthorizedException({
        code: 'INVALID_RESET_TOKEN',
        message: 'This reset link is invalid or has expired',
      });
    }

    const userId = claim.userId.toString();
    await this.usersService.updatePasswordHash(userId, newPasswordHash);
    await this.sessionsService.revokeAllForUser(userId);
  }

  private buildResetUrl(token: string): string {
    const appUrl =
      this.configService.get<string>('APP_URL') ?? 'http://localhost:3000';
    return `${appUrl}/reset-password?token=${token}`;
  }
}
