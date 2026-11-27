import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Response } from 'express';
import type { Model } from 'mongoose';
import { ApiTags } from '@nestjs/swagger';
import {
  changePlanSchema,
  listPlansQuerySchema,
  type ChangePlanInput,
  type ListPlansQuery,
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
import { DocumentRenderingService } from '../documents/rendering/document-rendering.service';
import { buildKorvaSubscriptionInvoiceManifest } from '../documents/templates/korva-subscription-invoice.template';
import {
  Organization,
  type OrganizationDocument,
} from '../organizations/schemas/organization.schema';

@ApiTags('subscriptions')
@Controller()
export class SubscriptionsController {
  constructor(
    private readonly plansService: PlansService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly entitlementsService: EntitlementsService,
    private readonly subscriptionInvoicesRepository: SubscriptionInvoicesRepository,
    private readonly documentRenderingService: DocumentRenderingService,
    // Registered in SubscriptionsModule already (see its own comment about the cycle).
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
  ) {}

  /**
   * The plans sellable in one currency. `@SkipTenant()` is kept — this is a price list, not
   * tenant data — so the currency arrives as a query parameter rather than from tenant context,
   * and the caller (Settings) passes its own organization's currency. Omitted, it falls back to
   * the platform's default billing currency.
   *
   * Validated against SUPPORTED_BILLING_CURRENCIES rather than accepted free-form: an unknown
   * currency would otherwise return an empty list, which reads as "we have no plans" instead of
   * "that is not a currency we bill in".
   */
  @SkipTenant()
  @Get('plans')
  listPlans(
    @Query(new ZodValidationPipe(listPlansQuerySchema))
    query: ListPlansQuery,
  ) {
    return this.plansService.list(query.currency);
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

  /**
   * The KORVA invoice as a PDF issued by VIT GLOBAL TECHNOLOGIES GROUP — what a business gives its
   * accountant for the subscription it paid. Scoped to the caller's organization: another
   * tenant's invoice id reads as not found.
   */
  @RequirePermissions('settings.manage')
  @Get('subscriptions/invoices/:id/pdf')
  async getInvoicePdf(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const invoice = await this.subscriptionInvoicesRepository.findOwnedById(
      tenant.organizationId,
      id,
    );
    if (!invoice) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_INVOICE_NOT_FOUND',
        message: 'Invoice not found',
      });
    }
    const [plan, organization] = await Promise.all([
      this.plansService.getById(invoice.planId.toString()),
      this.organizationModel.findById(tenant.organizationId).exec(),
    ]);
    if (!organization) {
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found',
      });
    }
    const buffer = await this.documentRenderingService.renderPdf(
      buildKorvaSubscriptionInvoiceManifest(invoice, plan, organization),
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', buffer.length.toString());
    res.setHeader(
      'Content-Disposition',
      `inline; filename="KORVA-${invoice.number}.pdf"`,
    );
    res.send(buffer);
  }

  @RequirePermissions('settings.manage')
  @Post('subscriptions/change-plan')
  changePlan(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(changePlanSchema)) body: ChangePlanInput,
  ) {
    return this.subscriptionsService.requestPlanChange(
      tenant.organizationId,
      user.userId,
      body.planKey,
      body.interval,
    );
  }

  /** Drops a requested plan change that was not paid. */
  @RequirePermissions('settings.manage')
  @Post('subscriptions/plan-change/cancel')
  @HttpCode(200)
  async cancelPlanChange(@CurrentTenant() tenant: TenantContext) {
    return {
      cancelled: await this.subscriptionsService.cancelPendingPlanChange(
        tenant.organizationId,
      ),
    };
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

  /** Starts the signup trial (SIGNUP_TRIAL) — once per organization, from the free plan. */
  @RequirePermissions('settings.manage')
  @Post('subscriptions/trial')
  startTrial(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.subscriptionsService.startTrial(
      tenant.organizationId,
      user.userId,
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
