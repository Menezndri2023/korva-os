import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createGiftCardSchema,
  payWithGiftCardSchema,
  type CreateGiftCardInput,
  type PayWithGiftCardInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { GiftCardsService } from './gift-cards.service';

@ApiTags('gift-cards')
@RequireModule('finance')
@Controller('gift-cards')
export class GiftCardsController {
  constructor(private readonly giftCardsService: GiftCardsService) {}

  @RequirePermissions('invoices.read')
  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.giftCardsService.list(tenant.organizationId);
  }

  @RequirePermissions('payments.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createGiftCardSchema))
    body: CreateGiftCardInput,
  ) {
    return this.giftCardsService.create(tenant.organizationId, body);
  }

  /** Pays an invoice with a card's code, up to its balance. */
  @RequirePermissions('payments.create')
  @Post('pay')
  @HttpCode(200)
  pay(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(payWithGiftCardSchema))
    body: PayWithGiftCardInput,
  ) {
    return this.giftCardsService.payInvoice(
      tenant.organizationId,
      user.userId,
      body.code,
      body.invoiceId,
      body.amount,
    );
  }

  @RequirePermissions('payments.create')
  @Post(':id/disable')
  @HttpCode(200)
  disable(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.giftCardsService.disable(tenant.organizationId, id);
  }

  @RequirePermissions('payments.create')
  @Post(':id/resend')
  @HttpCode(200)
  async resend(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    await this.giftCardsService.resend(tenant.organizationId, id);
    return { sent: true };
  }
}
