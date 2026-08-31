import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createReturnRequestSchema,
  listReturnRequestsQuerySchema,
  rejectReturnRequestSchema,
  type CreateReturnRequestInput,
  type ListReturnRequestsQuery,
  type RejectReturnRequestInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { ReturnRequestsService } from './return-requests.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';

@ApiTags('returns')
@RequireModule('commerce')
@Controller('returns')
export class ReturnRequestsController {
  constructor(private readonly returnRequestsService: ReturnRequestsService) {}

  @RequirePermissions('returns.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listReturnRequestsQuerySchema))
    query: ListReturnRequestsQuery,
  ) {
    return this.returnRequestsService.list(tenant.organizationId, query);
  }

  @RequirePermissions('returns.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.returnRequestsService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('returns.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createReturnRequestSchema))
    body: CreateReturnRequestInput,
  ) {
    // No expectedContactId: a staff caller may file a return for any order in the organization,
    // and the request is attributed to that order's own contact (never a staff-supplied one).
    return this.returnRequestsService.create(tenant.organizationId, body);
  }

  @RequirePermissions('returns.approve', 'payments.refund')
  @Post(':id/approve')
  approve(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.returnRequestsService.approve(
      tenant.organizationId,
      user.userId,
      id,
    );
  }

  @RequirePermissions('returns.approve')
  @Post(':id/reject')
  reject(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rejectReturnRequestSchema))
    body: RejectReturnRequestInput,
  ) {
    return this.returnRequestsService.reject(
      tenant.organizationId,
      user.userId,
      id,
      body.reason,
    );
  }
}
