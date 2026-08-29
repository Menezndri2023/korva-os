import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { TenantContext } from '@korva/types';
import { ActionCenterService } from './action-center.service';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';

/**
 * Gated on `recommendations.read` rather than a new permission: every role that can see
 * Recommendations (OWNER/ADMIN/MANAGER/SALES/FINANCE/STAFF — see rbac.ts) is exactly the
 * audience for "what needs attention across the system," and the other two item types
 * (pending AI approvals, workflow failures) are no more sensitive than that.
 */
@ApiTags('action-center')
@Controller('action-center')
export class ActionCenterController {
  constructor(private readonly actionCenterService: ActionCenterService) {}

  @RequirePermissions('recommendations.read')
  @Get('summary')
  getSummary(@CurrentTenant() tenant: TenantContext) {
    return this.actionCenterService.getSummary(tenant.organizationId);
  }

  @RequirePermissions('recommendations.read')
  @Get('feed')
  getFeed(@CurrentTenant() tenant: TenantContext) {
    return this.actionCenterService.getFeed(tenant.organizationId);
  }
}
