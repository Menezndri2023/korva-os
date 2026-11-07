import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  closeTillSchema,
  createCashSaleSchema,
  createCounterPaymentSchema,
  tillReportQuerySchema,
  type CloseTillInput,
  type CreateCashSaleInput,
  type CreateCounterPaymentInput,
  type TillReportQuery,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { RequirePlanFeature } from '../../common/decorators/require-plan-feature.decorator';
import { CounterPaymentsService } from './counter-payments.service';
import { TillService } from './till.service';

/** The counter QR code (see CounterPaymentsService). Same permissions as recording a payment. */
@ApiTags('counter-payments')
@Controller('counter-payments')
export class CounterPaymentsController {
  constructor(
    private readonly counterPaymentsService: CounterPaymentsService,
    private readonly tillService: TillService,
  ) {}

  /** Pro: the day's payments by method and by staff member, and its closing. Declared before
   *  `:id` so "till" is never read as a payment id. */
  @RequirePermissions('payments.read')
  @RequirePlanFeature('cash_closing')
  @Get('till')
  till(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(tillReportQuerySchema)) query: TillReportQuery,
  ) {
    return this.tillService.report(tenant.organizationId, query.day);
  }

  @RequirePermissions('payments.read')
  @RequirePlanFeature('cash_closing')
  @Get('till/closings')
  closings(@CurrentTenant() tenant: TenantContext) {
    return this.tillService.listClosings(tenant.organizationId);
  }

  @RequirePermissions('payments.create')
  @RequirePlanFeature('cash_closing')
  @Post('till/closings')
  close(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(closeTillSchema)) body: CloseTillInput,
  ) {
    return this.tillService.close(tenant.organizationId, user.userId, body);
  }

  @RequirePermissions('payments.read')
  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.counterPaymentsService.listRecent(tenant.organizationId);
  }

  /** A cash sale typed at the till — sent at once, or later by a till that was offline. */
  @RequirePermissions('payments.create')
  @Post('cash')
  cash(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createCashSaleSchema))
    body: CreateCashSaleInput,
  ) {
    return this.counterPaymentsService.recordCashSale(
      tenant.organizationId,
      user.userId,
      body,
    );
  }

  @RequirePermissions('payments.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createCounterPaymentSchema))
    body: CreateCounterPaymentInput,
  ) {
    return this.counterPaymentsService.create(
      tenant.organizationId,
      user.userId,
      body,
    );
  }

  @RequirePermissions('payments.read')
  @Get(':id')
  get(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.counterPaymentsService.get(tenant.organizationId, id);
  }
}
