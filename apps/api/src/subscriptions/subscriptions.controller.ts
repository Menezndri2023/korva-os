import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  changePlanSchema,
  type ChangePlanInput,
  cancelSubscriptionSchema,
  type CancelSubscriptionInput,
  updateProductOverridesSchema,
  type UpdateProductOverridesInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../core/tenant/request-context.types';
import { PlansService } from './plans.service';
import { SubscriptionsService } from './subscriptions.service';
import { EntitlementsService } from './entitlements.service';
import { SubscriptionInvoicesRepository } from './subscription-invoices.repository';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';

@ApiTags('subscriptions')
@Controller()
export class SubscriptionsController {
  constructor(
    private readonly plansService: PlansService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly entitlementsService: EntitlementsService,
    private readonly subscriptionInvoicesRepository: SubscriptionInvoicesRepository,
  ) {}

  @SkipTenant()
  @Get('plans')
  listPlans() {
    return this.plansService.list();
  }

  @Get('subscriptions/me')
  getMySubscription(@CurrentTenant() tenant: TenantContext) {
    return this.entitlementsService.getSummary(tenant.organizationId);
  }

  /**
   * The tenant's own KORVA billing history — the SubscriptionInvoices the period scheduler
   * issued for it. Read-only and tenant-scoped like every other route here; these are
   * KORVA-issued invoices, so there is nothing for a tenant to create or edit.
   *
   * Gated on 'settings.manage' rather than a finance permission on purpose: this is the
   * organization's own SaaS billing with KORVA (same concern as the plan/cancel routes below),
   * not the tenant's finance data that finance.* permissions govern.
   */
  @RequirePermissions('settings.manage')
  @Get('subscriptions/invoices')
  listMyInvoices(@CurrentTenant() tenant: TenantContext) {
    return this.subscriptionInvoicesRepository.listForOrganization(
      tenant.organizationId,
    );
  }

  @RequirePermissions('settings.manage')
  @Post('subscriptions/change-plan')
  changePlan(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(changePlanSchema)) body: ChangePlanInput,
  ) {
    return this.subscriptionsService.changePlan(
      tenant.organizationId,
      user.userId,
      body.planKey,
    );
  }

  @RequirePermissions('settings.manage')
  @Post('subscriptions/cancel')
  cancel(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(cancelSubscriptionSchema))
    body: CancelSubscriptionInput,
  ) {
    return this.subscriptionsService.cancel(
      tenant.organizationId,
      user.userId,
      body.immediate,
    );
  }

  @RequirePermissions('settings.manage')
  @Post('subscriptions/reactivate')
  reactivate(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptionsService.reactivate(
      tenant.organizationId,
      user.userId,
    );
  }

  @RequirePermissions('settings.manage')
  @Patch('subscriptions/product-overrides')
  updateProductOverrides(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(updateProductOverridesSchema))
    body: UpdateProductOverridesInput,
  ) {
    return this.subscriptionsService.updateProductOverrides(
      tenant.organizationId,
      user.userId,
      body.productOverrides,
    );
  }
}
