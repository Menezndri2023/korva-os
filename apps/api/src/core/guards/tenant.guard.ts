import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { SKIP_TENANT_KEY } from '../../common/decorators/skip-tenant.decorator';
import { MembershipsService } from '../../identity/memberships/memberships.service';
import type { RequestWithContext } from '../tenant/request-context.types';

/**
 * Resolves the active organization for the request from the X-Organization-Id header,
 * but only ever trusts it after verifying a real, active membership exists — the header
 * is a hint, never a bypass. Rejects the request outright if no valid tenant can be resolved.
 */
@Injectable()
export class TenantGuard {
  constructor(
    private readonly reflector: Reflector,
    private readonly membershipsService: MembershipsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const skipTenant = this.reflector.getAllAndOverride<boolean>(
      SKIP_TENANT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skipTenant) return true;

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    if (!request.user) {
      throw new ForbiddenException({
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      });
    }

    const organizationId = request.header('X-Organization-Id');
    if (!organizationId) {
      throw new ForbiddenException({
        code: 'ORGANIZATION_CONTEXT_REQUIRED',
        message: 'Missing X-Organization-Id header',
      });
    }

    const tenant = await this.membershipsService.resolveTenantContext(
      request.user.userId,
      organizationId,
    );
    if (!tenant) {
      throw new ForbiddenException({
        code: 'ORGANIZATION_ACCESS_DENIED',
        message: 'You do not have access to this organization',
      });
    }

    request.tenant = tenant;
    return true;
  }
}
