import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createCounterPaymentSchema,
  type CreateCounterPaymentInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { CounterPaymentsService } from './counter-payments.service';

/** The counter QR code (see CounterPaymentsService). Same permissions as recording a payment. */
@ApiTags('counter-payments')
@Controller('counter-payments')
export class CounterPaymentsController {
  constructor(
    private readonly counterPaymentsService: CounterPaymentsService,
  ) {}

  @RequirePermissions('payments.read')
  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.counterPaymentsService.listRecent(tenant.organizationId);
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
