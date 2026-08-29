import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  listRecommendationsQuerySchema,
  type ListRecommendationsQuery,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../core/tenant/request-context.types';
import { RecommendationsService } from './recommendations.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';

/**
 * Deliberately not gated behind @RequireModule: recommendations can be about an invoice
 * (finance) or a contact (crm) in the same list, and those two entity types already have their
 * own module gates on their own CRUD endpoints — gating this endpoint behind either one would
 * incorrectly hide the other's recommendations whenever just one module is disabled. RBAC
 * (`recommendations.read`/`.update`) still fully applies.
 */
@ApiTags('recommendations')
@Controller('recommendations')
export class RecommendationsController {
  constructor(
    private readonly recommendationsService: RecommendationsService,
  ) {}

  @RequirePermissions('recommendations.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listRecommendationsQuerySchema))
    query: ListRecommendationsQuery,
  ) {
    return this.recommendationsService.list(tenant.organizationId, query);
  }

  @RequirePermissions('recommendations.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.recommendationsService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('recommendations.update')
  @Post(':id/dismiss')
  dismiss(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.recommendationsService.dismiss(
      tenant.organizationId,
      user.userId,
      id,
    );
  }

  @RequirePermissions('recommendations.update')
  @Post(':id/resolve')
  resolve(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.recommendationsService.resolve(
      tenant.organizationId,
      user.userId,
      id,
    );
  }
}
