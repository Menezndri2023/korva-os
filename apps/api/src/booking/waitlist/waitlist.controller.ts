import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createWaitlistEntrySchema,
  listWaitlistEntriesQuerySchema,
  type CreateWaitlistEntryInput,
  type ListWaitlistEntriesQuery,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { WaitlistService } from './waitlist.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('waitlist')
@RequireModule('booking')
@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlistService: WaitlistService) {}

  @RequirePermissions('waitlist.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listWaitlistEntriesQuerySchema))
    query: ListWaitlistEntriesQuery,
  ) {
    return this.waitlistService.list(tenant.organizationId, query);
  }

  @RequirePermissions('waitlist.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.waitlistService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('waitlist.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createWaitlistEntrySchema))
    body: CreateWaitlistEntryInput,
  ) {
    return this.waitlistService.create(
      tenant.organizationId,
      user.userId,
      body,
    );
  }

  @RequirePermissions('waitlist.delete')
  @Post(':id/cancel')
  cancel(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.waitlistService.cancel(tenant.organizationId, user.userId, id);
  }
}
