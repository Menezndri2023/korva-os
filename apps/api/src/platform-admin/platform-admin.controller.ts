import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  assignPlanSchema,
  extendTrialSchema,
  suspendOrganizationSchema,
  type AssignPlanInput,
  type ExtendTrialInput,
  type SuspendOrganizationInput,
} from '@korva/validation';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../core/tenant/request-context.types';
import { PlatformAdminGuard } from './platform-admin.guard';
import {
  PlatformAdminService,
  type SubscriptionFilter,
} from './platform-admin.service';

const SUBSCRIPTION_FILTERS: SubscriptionFilter[] = [
  'all',
  'paid',
  'trial',
  'past_due',
  'canceling',
];

/** L'Administration de KORVA OS — see PlatformAdminGuard for who gets in. */
@ApiTags('platform')
@SkipTenant()
@UseGuards(PlatformAdminGuard)
@Controller('platform')
export class PlatformAdminController {
  constructor(private readonly adminService: PlatformAdminService) {}

  /** 200 for an administrator, 403 otherwise — what the dashboard asks before showing the menu. */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return { email: user.email, isPlatformAdmin: true };
  }

  @Get('overview')
  overview() {
    return this.adminService.overview();
  }

  /** Every business, whatever its trade, with what it needs and its activity. */
  @Get('businesses')
  businesses() {
    return this.adminService.businesses();
  }

  /** Kept for the old /platform/activation page and its bookmarks. */
  @Get('activation')
  activation() {
    return this.adminService.businesses();
  }

  @Get('subscriptions')
  subscriptions(@Query('filter') filter?: string) {
    const chosen = SUBSCRIPTION_FILTERS.includes(filter as SubscriptionFilter)
      ? (filter as SubscriptionFilter)
      : 'all';
    return this.adminService.subscriptions(chosen);
  }

  @Get('organizations/:id')
  organization(@Param('id') id: string) {
    return this.adminService.organization(id);
  }

  @Post('organizations/:id/plan')
  @HttpCode(200)
  assignPlan(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(assignPlanSchema)) body: AssignPlanInput,
  ) {
    return this.adminService.assignPlan(id, user.userId, body.planKey);
  }

  @Post('organizations/:id/trial')
  @HttpCode(200)
  extendTrial(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(extendTrialSchema)) body: ExtendTrialInput,
  ) {
    return this.adminService.extendTrial(id, user.userId, body.days);
  }

  @Post('organizations/:id/suspend')
  @HttpCode(200)
  suspend(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(suspendOrganizationSchema))
    body: SuspendOrganizationInput,
  ) {
    return this.adminService.suspend(id, user.userId, body.reason);
  }

  @Post('organizations/:id/reactivate')
  @HttpCode(200)
  reactivate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.adminService.reactivate(id, user.userId);
  }

  @Post('organizations/:id/invoices/:invoiceId/paid')
  @HttpCode(200)
  markInvoicePaid(
    @Param('id') id: string,
    @Param('invoiceId') invoiceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.adminService.markInvoicePaid(id, invoiceId, user.userId);
  }
}
