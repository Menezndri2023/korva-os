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
  type AssignPlanInput,
  type ExtendTrialInput,
} from '@korva/validation';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { AuthenticatedUser } from '../core/tenant/request-context.types';
import { ActivationReportService } from '../activation/activation-report.service';
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
  constructor(
    private readonly adminService: PlatformAdminService,
    private readonly activationReport: ActivationReportService,
  ) {}

  /** 200 for an administrator, 403 otherwise — what the dashboard asks before showing the menu. */
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return { email: user.email, isPlatformAdmin: true };
  }

  @Get('overview')
  overview() {
    return this.adminService.overview();
  }

  @Get('activation')
  activation() {
    return this.activationReport.report();
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
