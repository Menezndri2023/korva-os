import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  analyticsActivityQuerySchema,
  analyticsOverviewQuerySchema,
  analyticsRevenueQuerySchema,
  type AnalyticsActivityQuery,
  type AnalyticsOverviewQuery,
  type AnalyticsRevenueQuery,
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
}
