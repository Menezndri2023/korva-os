import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { TenantContext } from '@korva/types';
import { BusinessGraphService } from './business-graph.service';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { RequireModule } from '../common/decorators/require-module.decorator';

@ApiTags('business-graph')
@RequireModule('crm')
@Controller('business-graph')
export class BusinessGraphController {
  constructor(private readonly businessGraphService: BusinessGraphService) {}

  @RequirePermissions('contacts.read')
  @Get('contacts/:id/timeline')
  getContactTimeline(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    return this.businessGraphService.getContactTimeline(
      tenant.organizationId,
      id,
    );
  }

  /** Phase F1 — org-level counterpart to the per-contact timeline above. Overrides the
   *  controller's own `@RequireModule('crm')` with `'analytics'` (a method-level
   *  `@RequireModule` replaces, not adds to, the class-level one — see ModuleGuard's
   *  `getAllAndOverride`) and gates on `analytics.read` rather than `contacts.read`: this
   *  spans CRM/Finance/Inventory/Suppliers, not CRM specifically, matching
   *  AnalyticsController's own module gate. */
  @RequireModule('analytics')
  @RequirePermissions('analytics.read')
  @Get('organization/summary')
  getOrganizationSummary(@CurrentTenant() tenant: TenantContext) {
    return this.businessGraphService.getOrganizationSummary(
      tenant.organizationId,
    );
  }
}
