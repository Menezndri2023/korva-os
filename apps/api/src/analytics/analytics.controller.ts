import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  analyticsActivityQuerySchema,
  analyticsOverviewQuerySchema,
  analyticsRevenueQuerySchema,
  inventoryDeadStockQuerySchema,
  inventoryTurnoverQuerySchema,
  type AnalyticsActivityQuery,
  type AnalyticsOverviewQuery,
  type AnalyticsRevenueQuery,
  type InventoryDeadStockQuery,
  type InventoryTurnoverQuery,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { AnalyticsService } from './analytics.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { RequireModule } from '../common/decorators/require-module.decorator';

@ApiTags('analytics')
@RequireModule('analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @RequirePermissions('analytics.read')
  @Get('overview')
  getOverview(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(analyticsOverviewQuerySchema))
    query: AnalyticsOverviewQuery,
  ) {
    return this.analyticsService.getOverview(
      tenant.organizationId,
      query.from,
      query.to,
    );
  }

  @RequirePermissions('analytics.read')
  @Get('revenue-timeseries')
  getRevenueTimeseries(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(analyticsRevenueQuerySchema))
    query: AnalyticsRevenueQuery,
  ) {
    return this.analyticsService.getRevenueTimeseries(
      tenant.organizationId,
      query,
    );
  }

  @RequirePermissions('analytics.read')
  @Get('activity')
  getActivity(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(analyticsActivityQuerySchema))
    query: AnalyticsActivityQuery,
  ) {
    return this.analyticsService.getActivity(
      tenant.organizationId,
      query.limit,
    );
  }

  /** Phase C3 (docs/KORVA_OS_V2_AUDIT.md §2.4) — inventory analytics, off the existing
   *  StockMovement ledger. Gated the same as every other analytics endpoint here (analytics.read
   *  only, no extra `catalog` module check — mirrors how the CRM-facing endpoints above never
   *  check `crm`/`commerce`/`finance` either). */
  @RequirePermissions('analytics.read')
  @Get('inventory/turnover')
  getInventoryTurnover(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(inventoryTurnoverQuerySchema))
    query: InventoryTurnoverQuery,
  ) {
    return this.analyticsService.getInventoryTurnover(
      tenant.organizationId,
      query.days,
    );
  }

  @RequirePermissions('analytics.read')
  @Get('inventory/dead-stock')
  getDeadStock(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(inventoryDeadStockQuerySchema))
    query: InventoryDeadStockQuery,
  ) {
    return this.analyticsService.getDeadStock(
      tenant.organizationId,
      query.days,
    );
  }

  @RequirePermissions('analytics.read')
  @Get('inventory/valuation')
  getInventoryValuation(@CurrentTenant() tenant: TenantContext) {
    return this.analyticsService.getInventoryValuation(tenant.organizationId);
  }

  @RequirePermissions('analytics.read')
  @Get('inventory/reorder-suggestions')
  getReorderSuggestions(@CurrentTenant() tenant: TenantContext) {
    return this.analyticsService.getReorderSuggestions(tenant.organizationId);
  }
}
