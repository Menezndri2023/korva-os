import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../core/tenant/request-context.types';
import { SubscriptionBillingService } from './subscription-billing.service';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';

/**
 * Paying KORVA's own SaaS invoices. Gated on 'settings.manage' — the same permission as the
 * plan-change/cancel routes in SubscriptionsController, since this is the organization's billing
 * relationship with KORVA rather than the tenant finance data finance.* permissions govern.
 */
@ApiTags('subscriptions')
@Controller('subscriptions/invoices')
export class SubscriptionBillingController {
  constructor(private readonly billingService: SubscriptionBillingService) {}

  @RequirePermissions('settings.manage')
  @Post(':id/checkout')
  createCheckout(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.billingService.createCheckout(
      tenant.organizationId,
      id,
      user.email,
    );
  }

  /** Asks the provider what really happened — never trusts the payer's return redirect. */
  @RequirePermissions('settings.manage')
  @Post(':id/verify')
  verify(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.billingService.verifyPayment(tenant.organizationId, id);
  }

  /** Pays the invoice from the business's Solde KORVA. */
  @RequirePermissions('settings.manage')
  @Post(':id/pay-from-wallet')
  @HttpCode(200)
  payFromWallet(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    return this.billingService.payFromWallet(tenant.organizationId, id);
  }
}
