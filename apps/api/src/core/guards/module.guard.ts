import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { KorvaModule } from '@korva/types';
import { MODULE_KEY } from '../../common/decorators/require-module.decorator';
import type { RequestWithContext } from '../tenant/request-context.types';

/**
 * Runs after TenantGuard (so request.tenant is already resolved) and before PermissionsGuard —
 * a cross-tenant caller must still see ORGANIZATION_ACCESS_DENIED, never MODULE_NOT_ENABLED,
 * and RBAC keeps deciding per-user access once the module itself is confirmed reachable.
 */
@Injectable()
export class ModuleGuard {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<KorvaModule>(MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const enabledModules = request.tenant?.enabledModules ?? [];

    if (!enabledModules.includes(required)) {
      throw new ForbiddenException({
        code: 'MODULE_NOT_ENABLED',
        message: `This organization has not enabled the "${required}" module`,
        details: { module: required },
      });
    }

    return true;
  }
}
