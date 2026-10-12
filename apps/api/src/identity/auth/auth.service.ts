import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import type { RegisterInput, LoginInput } from '@korva/validation';
import { UsersService } from '../users/users.service';
import { SessionsService } from './sessions.service';
import { EmailVerificationService } from './email-verification.service';
import { TwoFactorService } from './two-factor.service';
import { UserDocument } from '../schemas/user.schema';
import { hashToken } from './token-hash.util';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** Consecutive failed attempts allowed before an account is temporarily locked. */
const MAX_FAILED_ATTEMPTS = 5;
/** How long an account stays locked once MAX_FAILED_ATTEMPTS is reached. */
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

function toPublicUser(user: UserDocument) {
  return {
    id: user.id as string,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    emailVerifiedAt: user.emailVerifiedAt,
    totpEnabled: user.totpEnabled,
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly refreshTtlMs: number;

  constructor(
    private readonly usersService: UsersService,
    private readonly sessionsService: SessionsService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    // Optional purely so the existing auth.service.spec.ts (which constructs AuthService
    // directly with `new`, outside this lot's authorized scope) keeps compiling unchanged —
    // Nest's DI graph in identity.module.ts always provides a real instance at runtime.
    private readonly emailVerificationService?: EmailVerificationService,
    private readonly twoFactorService?: TwoFactorService,
  ) {
    this.refreshTtlMs = this.parseTtlToMs(
      this.configService.get<string>('JWT_REFRESH_TTL') ?? '30d',
    );
  }

  async register(input: RegisterInput) {
    const existing = await this.usersService.findByEmail(input.email);
    if (existing) {
      throw new ConflictException({
        code: 'EMAIL_TAKEN',
        message: 'An account with this email already exists',
      });
    }

    const user = await this.usersService.create(
      input.email,
      input.password,
      input.firstName,
      input.lastName,
    );

    // Additive to registration, never allowed to affect its outcome — a failure here (token
    // issuance or email delivery) must never turn a successful account creation into a failed
    // request. Verification stays informative-only in this lot: nothing downstream reads
    // emailVerifiedAt to gate access (see EmailVerificationService's class doc).
    try {
      await this.emailVerificationService?.sendVerification(user);
    } catch (error) {
      this.logger.error('Failed to issue email verification token', error);
    }

    const tokens = await this.issueTokens(user);
    return { user: toPublicUser(user), ...tokens };
  }

  async login(input: LoginInput) {
    const user = await this.usersService.findByEmail(input.email, true);
    if (!user) {
      this.logAuthEvent('AUTH_LOGIN_FAILED', {
        reason: 'unknown_email',
        email: input.email,
      });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    // Checked BEFORE password verification: a locked account must reject every attempt
    // (correct password or not) until the cooldown elapses, and must never leak whether the
    // password itself was right or wrong while locked.
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      this.logAuthEvent('AUTH_LOGIN_BLOCKED', {
        reason: 'account_locked',
        userId: user.id as string,
        lockedUntil: user.lockedUntil.toISOString(),
      });
      throw new UnauthorizedException({
        code: 'ACCOUNT_LOCKED',
        message:
          'This account is temporarily locked due to too many failed login attempts. Try again later.',
      });
    }

    const valid = await this.usersService.verifyPassword(
      user.passwordHash,
      input.password,
    );
    if (!valid) {
      await this.registerFailedAttempt(user);
      this.logAuthEvent('AUTH_LOGIN_FAILED', {
        reason: 'bad_password',
        userId: user.id as string,
      });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    if (user.totpEnabled) {
      if (!input.totpCode) {
        throw new UnauthorizedException({
          code: 'TOTP_REQUIRED',
          message: 'A verification code is required to complete login',
        });
      }
      const secret = user.totpSecretEncrypted;
      const codeValid =
        !!secret &&
        !!this.twoFactorService?.verifyActiveCode(secret, input.totpCode);
      if (!codeValid) {
        await this.registerFailedAttempt(user);
        this.logAuthEvent('AUTH_LOGIN_FAILED', {
          reason: 'bad_totp_code',
          userId: user.id as string,
        });
        throw new UnauthorizedException({
          code: 'INVALID_TOTP_CODE',
          message: 'Invalid verification code',
        });
      }
    }

    // A genuinely successful login (password, and TOTP code if enabled) always clears any
    // accumulated failed-attempt count — see AuthService.login's class-level lockout doc.
    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.usersService.resetFailedAttempts(user.id as string);
    }

    const tokens = await this.issueTokens(user);
    this.logAuthEvent('AUTH_LOGIN_SUCCEEDED', {
      userId: user.id as string,
      twoFactor: user.totpEnabled === true,
    });
    return { user: toPublicUser(user), ...tokens };
  }

  /**
   * Increments the failed-attempt counter and, once it reaches MAX_FAILED_ATTEMPTS, locks the
   * account for LOCKOUT_DURATION_MS and resets the counter back to 0 so the next window (after
   * unlock) starts fresh — see UsersRepository.lockAccount.
   */
  private async registerFailedAttempt(user: UserDocument): Promise<void> {
    const attempts = await this.usersService.incrementFailedAttempts(
      user.id as string,
    );
    if (attempts >= MAX_FAILED_ATTEMPTS) {
      await this.usersService.lockAccount(
        user.id as string,
        new Date(Date.now() + LOCKOUT_DURATION_MS),
      );
      this.logAuthEvent('AUTH_ACCOUNT_LOCKED', {
        userId: user.id as string,
        attempts,
        lockoutMs: LOCKOUT_DURATION_MS,
      });
    }
  }

  /**
   * Authentication events go to the structured log, NOT to AuditService.
   *
   * AuditLog.organizationId is `required` and AuditService.listRecent filters on it (it backs a
   * tenant-visible read API) — but a login has no organization: the user picks one afterwards,
   * and may belong to several. Writing these as audit rows would mean either making the tenant
   * scope nullable, which breaks the isolation guarantee that read API rests on, or inventing a
   * second audit concept for six log lines. StructuredLogger already emits JSON stamped with
   * the request id (common/logging/structured-logger.service.ts), which is what a log
   * aggregator needs — so these are platform security events in the log stream rather than
   * tenant business events in the audit trail. Recorded against
   * docs/PRODUCTION_READINESS.md §24's "Add audit logging to login/logout events".
   *
   * `email` is included ONLY for the unknown-email case, where there is no userId to identify
   * the attempt by and a line with no identifier at all would be useless for incident response.
   * Every other event carries userId instead. The password, the TOTP code, the TOTP secret and
   * any token or token hash are never passed in — asserted by this file's own spec.
   */
  private logAuthEvent(
    event: string,
    details: Record<string, string | number | boolean>,
  ): void {
    this.logger.log(`${event} ${JSON.stringify(details)}`);
  }

  /**
   * `revokeActiveByTokenHash` finds-and-revokes the session in one atomic MongoDB write, so
   * two concurrent requests presenting the same token can never both see it as active — only
   * one gets the session back (and rotates into a new one below); the other gets `null` and
   * falls straight into the reuse-detection path, exactly as if the token had already been
   * rotated away by a prior legitimate request (see SessionsRepository.revokeActiveByTokenHash
   * and detectRefreshTokenReuse).
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    const tokenHash = hashToken(refreshToken);
    const session =
      await this.sessionsService.revokeActiveByTokenHash(tokenHash);
    if (!session) {
      await this.detectRefreshTokenReuse(tokenHash);
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired',
      });
    }

    const user = await this.usersService.findById(session.userId.toString());
    if (!user) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Refresh token is invalid or expired',
      });
    }

    return this.issueTokens(user);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await this.sessionsService.revokeByTokenHash(tokenHash);
    // No outcome in the line: revokeByTokenHash returns void, and the endpoint deliberately
    // answers identically for a known, an already-revoked and an entirely unknown token.
    this.logAuthEvent('AUTH_LOGOUT', {});
  }

  /**
   * Rotation never deletes a session row, it only sets `revokedAt` — so a hash that isn't
   * found "active" is ambiguous by itself: it could be a token that never existed, one that
   * simply expired without ever being used again, or one that was already rotated away and is
   * now being presented a second time (a strong signal the refresh token was stolen, since a
   * legitimate client only ever uses each refresh token once). This distinguishes those cases
   * by re-querying without the active-only filter, and only the "known but revoked" case is
   * treated as a compromise signal — an expired-but-never-used or entirely unknown token is
   * left exactly as it was handled before this method existed.
   *
   * Known false-positive: a `refresh` racing a `logout` of the SAME token can see it as
   * "known but revoked" (revoked by the legitimate logout, not theft) and trigger this same
   * global revocation. The `Session` schema has no field recording *why* a session was
   * revoked, so this method cannot distinguish "revoked by rotation/logout" from "revoked,
   * then presented again" — closing that gap would need a schema change (e.g. a
   * `revokedReason` field), not a fix that fits within this method. Left as a documented,
   * accepted risk rather than an undocumented one.
   */
  private async detectRefreshTokenReuse(tokenHash: string): Promise<void> {
    const knownSession = await this.sessionsService.findByTokenHash(tokenHash);
    if (!knownSession || knownSession.revokedAt === null) {
      return;
    }
    this.logger.warn(
      `Refresh token reuse detected for user ${knownSession.userId.toString()} — revoking all active sessions`,
    );
    await this.sessionsService.revokeAllForUser(knownSession.userId.toString());
  }

  /** Exposes the already-computed refresh TTL so the controller can set a matching cookie maxAge. */
  getRefreshTtlMs(): number {
    return this.refreshTtlMs;
  }

  private async issueTokens(user: UserDocument): Promise<AuthTokens> {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id as string,
      email: user.email,
    });

    const refreshToken = randomBytes(48).toString('hex');
    await this.sessionsService.create({
      userId: user.id as string,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + this.refreshTtlMs),
    });

    return { accessToken, refreshToken };
  }

  private parseTtlToMs(ttl: string): number {
    const match = /^(\d+)([smhd])$/.exec(ttl);
    if (!match) return 30 * 24 * 60 * 60 * 1000;
    const value = Number(match[1]);
    const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
    return value * unitMs[match[2] as keyof typeof unitMs];
  }
}
