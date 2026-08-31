import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createRecurringBillingSchema,
  listRecurringBillingsQuerySchema,
  type CreateRecurringBillingInput,
  type ListRecurringBillingsQuery,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { RecurringBillingService } from './recurring-billing.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';

/** Reuses the existing `invoices.*` permissions (read/create/update) rather than introducing a
 *  new permission category — a recurring billing plan is, functionally, a standing instruction
 *  to create invoices automatically, the closest existing resource conceptually (same reasoning
 *  already applied to Review reusing `orders.read`). */
@ApiTags('recurring-billing')
@RequireModule('finance')
@Controller('recurring-billing')
export class RecurringBillingController {
  constructor(
    private readonly recurringBillingService: RecurringBillingService,
  ) {}

  @RequirePermissions('invoices.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listRecurringBillingsQuerySchema))
    query: ListRecurringBillingsQuery,
  ) {
    return this.recurringBillingService.list(tenant.organizationId, query);
  }

  @RequirePermissions('invoices.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.recurringBillingService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('invoices.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createRecurringBillingSchema))
    body: CreateRecurringBillingInput,
  ) {
    return this.recurringBillingService.create(
      tenant.organizationId,
      user.userId,
      body,
    );
  }

  @RequirePermissions('invoices.update')
  @Post(':id/cancel')
  cancel(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.recurringBillingService.cancel(
      tenant.organizationId,
      user.userId,
      id,
    );
  }
}
