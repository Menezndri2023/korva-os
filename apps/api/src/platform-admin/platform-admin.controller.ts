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
import { Public } from '../common/decorators/public.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { PlatformAdminIdentity } from './platform-admin-auth.service';
import {
  CurrentPlatformAdmin,
  PlatformAdminGuard,
} from './platform-admin.guard';
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

/**
 * L'Administration de KORVA OS. @Public() steps the businesses' guards aside (their JWT, tenancy,
 * modules, permissions); PlatformAdminGuard alone decides, on an administrator token.
 */
@ApiTags('platform')
@Public()
@UseGuards(PlatformAdminGuard)
@Controller('platform')
export class PlatformAdminController {
  constructor(private readonly adminService: PlatformAdminService) {}

  /** 200 for an administrator, 403 otherwise — what the dashboard asks before showing the menu. */
  @Get('me')
  me(@CurrentPlatformAdmin() admin: PlatformAdminIdentity) {
    return { email: admin.email, isPlatformAdmin: true };
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
    @CurrentPlatformAdmin() admin: PlatformAdminIdentity,
    @Body(new ZodValidationPipe(assignPlanSchema)) body: AssignPlanInput,
  ) {
    return this.adminService.assignPlan(
      id,
      admin.id,
      body.planKey,
      body.interval,
    );
  }

  @Post('organizations/:id/trial')
  @HttpCode(200)
  extendTrial(
    @Param('id') id: string,
    @CurrentPlatformAdmin() admin: PlatformAdminIdentity,
    @Body(new ZodValidationPipe(extendTrialSchema)) body: ExtendTrialInput,
  ) {
    return this.adminService.extendTrial(id, admin.id, body.days);
  }

  @Post('organizations/:id/suspend')
  @HttpCode(200)
  suspend(
    @Param('id') id: string,
    @CurrentPlatformAdmin() admin: PlatformAdminIdentity,
    @Body(new ZodValidationPipe(suspendOrganizationSchema))
    body: SuspendOrganizationInput,
  ) {
    return this.adminService.suspend(id, admin.id, body.reason);
  }

  /** "Voir son tableau de bord": a 30-minute read-only token (see PlatformAdminService.viewAs). */
  @Post('organizations/:id/view-as')
  @HttpCode(200)
  viewAs(
    @Param('id') id: string,
    @CurrentPlatformAdmin() admin: PlatformAdminIdentity,
  ) {
    return this.adminService.viewAs(id, admin.id);
  }

  @Post('organizations/:id/reactivate')
  @HttpCode(200)
  reactivate(
    @Param('id') id: string,
    @CurrentPlatformAdmin() admin: PlatformAdminIdentity,
  ) {
    return this.adminService.reactivate(id, admin.id);
  }

  @Get('plans')
  plans() {
    return this.adminService.plans();
  }

  @Get('audit')
  audit(
    @Query('organizationId') organizationId?: string,
    @Query('page') page?: string,
  ) {
    return this.adminService.audit({
      organizationId,
      page: page ? Number(page) : 1,
    });
  }

  @Get('system')
  system() {
    return this.adminService.system();
  }

  @Get('users')
  users(@Query('q') q?: string) {
    return this.adminService.users(q);
  }

  @Post('users/:id/disable')
  @HttpCode(200)
  disableUser(
    @Param('id') id: string,
    @CurrentPlatformAdmin() admin: PlatformAdminIdentity,
  ) {
    return this.adminService.disableUser(id, admin.id);
  }

  @Post('users/:id/enable')
  @HttpCode(200)
  enableUser(
    @Param('id') id: string,
    @CurrentPlatformAdmin() admin: PlatformAdminIdentity,
  ) {
    return this.adminService.enableUser(id, admin.id);
  }

  @Post('users/:id/password-reset')
  @HttpCode(200)
  sendPasswordReset(
    @Param('id') id: string,
    @CurrentPlatformAdmin() admin: PlatformAdminIdentity,
  ) {
    return this.adminService.sendPasswordReset(id, admin.id);
  }

  @Post('organizations/:id/invoices/:invoiceId/paid')
  @HttpCode(200)
  markInvoicePaid(
    @Param('id') id: string,
    @Param('invoiceId') invoiceId: string,
    @CurrentPlatformAdmin() admin: PlatformAdminIdentity,
  ) {
    return this.adminService.markInvoicePaid(id, invoiceId, admin.id);
  }
}
