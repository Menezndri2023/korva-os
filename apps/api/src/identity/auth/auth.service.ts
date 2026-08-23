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
import { UserDocument } from '../schemas/user.schema';
import { hashToken } from './token-hash.util';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

function toPublicUser(user: UserDocument) {
  return {
    id: user.id as string,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    emailVerifiedAt: user.emailVerifiedAt,
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
    const tokens = await this.issueTokens(user);
    return { user: toPublicUser(user), ...tokens };
  }

  async login(input: LoginInput) {
    const user = await this.usersService.findByEmail(input.email, true);
    if (!user) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    const valid = await this.usersService.verifyPassword(
      user.passwordHash,
      input.password,
    );
    if (!valid) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    const tokens = await this.issueTokens(user);
    return { user: toPublicUser(user), ...tokens };
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
