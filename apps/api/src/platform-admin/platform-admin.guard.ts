import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  PlatformAdminAuthService,
  type PlatformAdminIdentity,
} from './platform-admin-auth.service';

export { platformAdminEmails } from './platform-admin-auth.service';

type AdminRequest = Request & { platformAdmin?: PlatformAdminIdentity };

/**
 * Admits a request only with a valid administrator token (see PlatformAdminAuthService) — never
 * with a business user's token. The routes it protects are marked @Public() so the businesses'
 * JWT and tenant guards stand aside; this guard is then the only gate, and it is closed unless
 * the account exists AND its address is listed in PLATFORM_ADMIN_EMAILS.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly auth: PlatformAdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const admin = token ? await this.auth.verify(token) : null;
    if (!admin) {
      throw new ForbiddenException({
        code: 'PLATFORM_ADMIN_ONLY',
        message: 'Reserved to KORVA platform administrators',
      });
    }
    request.platformAdmin = admin;
    return true;
  }
}

/** The administrator PlatformAdminGuard admitted. */
export const CurrentPlatformAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PlatformAdminIdentity =>
    context.switchToHttp().getRequest<AdminRequest>().platformAdmin!,
);
