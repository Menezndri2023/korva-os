import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../identity/schemas/user.schema';
import type { RequestWithContext } from '../core/tenant/request-context.types';

/** The configured administrators, normalised. Exported for the tests. */
export function platformAdminEmails(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * KORVA's own administration — the team running the platform, not a tenant's staff. It sits
 * outside tenancy and every tenant role: access is decided only by PLATFORM_ADMIN_EMAILS
 * (comma-separated, set by the operator on the server). Unset or empty, nobody is admitted —
 * closed by default.
 *
 * Checked against the user's CURRENT email in the database rather than the address in the token,
 * so a user who changes their email cannot keep a grant made for the old one. Runs after the
 * global JwtAuthGuard, so `request.user` is always set here.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(
    private readonly configService: ConfigService,
    @InjectModel(User.name) private readonly userModel: Model<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const allowed = platformAdminEmails(
      this.configService.get<string>('PLATFORM_ADMIN_EMAILS'),
    );
    const user =
      allowed.length && request.user
        ? await this.userModel
            .findById(request.user.userId, { email: 1 })
            .lean<{ email: string }>()
            .exec()
        : null;
    if (!user || !allowed.includes(user.email.toLowerCase())) {
      throw new ForbiddenException({
        code: 'PLATFORM_ADMIN_ONLY',
        message: 'Reserved to KORVA platform administrators',
      });
    }
    return true;
  }
}
