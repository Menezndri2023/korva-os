import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlanFeature } from '@korva/types';
import { PLAN_FEATURE_KEY } from '../../common/decorators/require-plan-feature.decorator';
import type { RequestWithContext } from '../tenant/request-context.types';
import { EntitlementsService } from '../../subscriptions/entitlements.service';

/**
 * Runs after ModuleGuard (a module that is off answers MODULE_NOT_ENABLED first) and before
 * PermissionsGuard, like ModuleGuard does. A route without @RequirePlanFeature costs nothing: no
 * plan is read.
 */
@Injectable()
export class PlanFeatureGuard {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlementsService: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const feature = this.reflector.getAllAndOverride<PlanFeature>(
      PLAN_FEATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!feature) return true;

    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const organizationId = request.tenant?.organizationId;
    if (!organizationId) return true; // tenant-less routes are TenantGuard's business
    await this.entitlementsService.assertFeature(organizationId, feature);
    return true;
  }
}
