import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import * as argon2 from 'argon2';
import { createHmac, randomBytes } from 'node:crypto';
import { Model } from 'mongoose';
import {
  PlatformAdmin,
  type PlatformAdminDocument,
} from './schemas/platform-admin.schema';

const TOKEN_TYPE = 'platform_admin';
/** An administration session lasts a working day; there is no refresh token. */
const TOKEN_TTL = '8h';
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;
/** Generated passwords: 18 random bytes → 24 base64url characters (~144 bits). */
const GENERATED_PASSWORD_BYTES = 18;

export interface PlatformAdminIdentity {
  id: string;
  email: string;
}

interface AdminTokenPayload {
  sub: string;
  email: string;
  typ: string;
}

/** The configured administrators, normalised. Exported for the tests. */
export function platformAdminEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Sign-in for KORVA's administration, separate from the businesses' sign-in end to end: its own
 * accounts (PlatformAdmin), its own token, signed with its own key. That key is derived from
 * JWT_SECRET (HMAC with a fixed label) so no new secret has to be provisioned, yet a tenant access
 * token can never verify as an administrator token, nor the reverse.
 *
 * Two conditions to get in, checked on every request (PlatformAdminGuard): the account exists,
 * and its address is still listed in PLATFORM_ADMIN_EMAILS — removing an address from the server
 * configuration revokes that administrator immediately, whatever tokens they hold.
 */
@Injectable()
export class PlatformAdminAuthService {
  private readonly logger = new Logger(PlatformAdminAuthService.name);

  constructor(
    @InjectModel(PlatformAdmin.name)
    private readonly adminModel: Model<PlatformAdmin>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private signingKey(): string {
    return createHmac(
      'sha256',
      this.configService.getOrThrow<string>('JWT_SECRET'),
    )
      .update('korva-platform-admin-v1')
      .digest('hex');
  }

  private allowed(email: string): boolean {
    return platformAdminEmails(
      this.configService.get<string>('PLATFORM_ADMIN_EMAILS'),
    ).includes(email.toLowerCase());
  }

  async login(
    email: string,
    password: string,
  ): Promise<{ accessToken: string; email: string }> {
    const normalised = email.trim().toLowerCase();
    const admin = await this.adminModel
      .findOne({ email: normalised })
      .select('+passwordHash')
      .exec();
    const refuse = () =>
      new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    if (!admin || !this.allowed(normalised)) {
      this.logger.warn(`Platform admin login refused for ${normalised}`);
      throw refuse();
    }
    if (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) {
      throw new ForbiddenException({
        code: 'ACCOUNT_LOCKED',
        message: 'Too many failed attempts. Try again later.',
      });
    }
    if (!(await argon2.verify(admin.passwordHash, password))) {
      admin.failedLoginAttempts += 1;
      if (admin.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
        admin.lockedUntil = new Date(Date.now() + LOCK_MS);
        admin.failedLoginAttempts = 0;
        this.logger.warn(
          `Platform admin ${normalised} locked after repeated failures`,
        );
      }
      await admin.save();
      throw refuse();
    }
    admin.failedLoginAttempts = 0;
    admin.lockedUntil = null;
    admin.lastLoginAt = new Date();
    await admin.save();
    this.logger.log(`Platform admin ${normalised} signed in`);
    return { accessToken: this.issueToken(admin), email: admin.email };
  }

  private issueToken(admin: PlatformAdminDocument): string {
    const payload: AdminTokenPayload = {
      sub: admin.id as string,
      email: admin.email,
      typ: TOKEN_TYPE,
    };
    return this.jwtService.sign(payload, {
      secret: this.signingKey(),
      expiresIn: TOKEN_TTL,
    });
  }

  /** The administrator behind a token, or null when it is invalid, expired or no longer allowed. */
  async verify(token: string): Promise<PlatformAdminIdentity | null> {
    let payload: AdminTokenPayload;
    try {
      payload = this.jwtService.verify<AdminTokenPayload>(token, {
        secret: this.signingKey(),
      });
    } catch {
      return null;
    }
    if (payload.typ !== TOKEN_TYPE || !this.allowed(payload.email)) return null;
    const admin = await this.adminModel
      .findById(payload.sub)
      .lean<{ _id: unknown; email: string }>()
      .exec();
    if (!admin || admin.email !== payload.email) return null;
    return { id: payload.sub, email: admin.email };
  }

  async changePassword(
    adminId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const admin = await this.adminModel
      .findById(adminId)
      .select('+passwordHash')
      .exec();
    if (!admin || !(await argon2.verify(admin.passwordHash, currentPassword))) {
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Current password is incorrect',
      });
    }
    admin.passwordHash = await argon2.hash(newPassword);
    admin.passwordChangedAt = new Date();
    await admin.save();
  }

  /**
   * Creates the administrator account for `email`, or gives it a new password — always a freshly
   * generated one, returned to the caller (the server command) to be shown once and never stored
   * in clear. Refuses an address absent from PLATFORM_ADMIN_EMAILS.
   */
  async provision(
    email: string,
  ): Promise<{ email: string; password: string; created: boolean }> {
    const normalised = email.trim().toLowerCase();
    if (!this.allowed(normalised)) {
      throw new ForbiddenException({
        code: 'NOT_A_PLATFORM_ADMIN_EMAIL',
        message: `${normalised} is not listed in PLATFORM_ADMIN_EMAILS`,
      });
    }
    const password = randomBytes(GENERATED_PASSWORD_BYTES).toString(
      'base64url',
    );
    const passwordHash = await argon2.hash(password);
    const existing = await this.adminModel
      .findOne({ email: normalised })
      .exec();
    if (existing) {
      existing.passwordHash = passwordHash;
      existing.passwordChangedAt = new Date();
      existing.failedLoginAttempts = 0;
      existing.lockedUntil = null;
      await existing.save();
      return { email: normalised, password, created: false };
    }
    await this.adminModel.create({ email: normalised, passwordHash });
    return { email: normalised, password, created: true };
  }
}
