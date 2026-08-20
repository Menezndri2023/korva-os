import { Body, Controller, Get, Post, Query } from '@nestjs/common';
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

@ApiTags('payments')
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
  ) {
    return this.paymentsService.create(
      tenant.organizationId,
      user.userId,
      body,
    );
  }

  @RequirePermissions('payments.refund')
  @Post('refunds')
  refund(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createRefundSchema)) body: CreateRefundInput,
  ) {
    return this.paymentsService.refund(
      tenant.organizationId,
      user.userId,
      body,
    );
  }
}
