import { Body, Controller, Get, Headers, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createPaymentSchema,
  createRefundSchema,
  type CreatePaymentInput,
  type CreateRefundInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { PaymentsService } from './payments.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('payments')
@RequireModule('finance')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @RequirePermissions('payments.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query('invoiceId') invoiceId?: string,
  ) {
    return this.paymentsService.list(tenant.organizationId, invoiceId);
  }

  @RequirePermissions('payments.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createPaymentSchema)) body: CreatePaymentInput,
    // Optional — legacy callers that don't send it keep today's exact (non-idempotent)
    // behavior. Standard HTTP header, not a body field, so retries/proxies/clients can attach
    // it uniformly without touching the request payload.
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.paymentsService.create(
      tenant.organizationId,
      user.userId,
      body,
      idempotencyKey,
    );
  }

  /**
   * Stage 2.7B — `Idempotency-Key` is MANDATORY here (unlike `create()` above, which keeps it
   * optional): a refund's provider call is the case where retrying after an ambiguous timeout
   * can move real money a second time (see Stage 2.6/2.7A's audits) — requiring a key is what
   * makes a safe retry (same key → returns the existing claim, never calls the provider again)
   * the only way to retry at all. Enforced in `PaymentsService.refund()` itself
   * (`REFUND_IDEMPOTENCY_KEY_REQUIRED`, a 400), not here, so the rule holds for every caller of
   * that service method, not only this HTTP route.
   */
  @RequirePermissions('payments.refund')
  @Post('refunds')
  refund(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createRefundSchema)) body: CreateRefundInput,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.paymentsService.refund(
      tenant.organizationId,
      user.userId,
      body,
      idempotencyKey,
    );
  }
}
