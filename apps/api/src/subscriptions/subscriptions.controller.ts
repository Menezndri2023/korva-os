import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { changePlanSchema, type ChangePlanInput } from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../core/tenant/request-context.types';
import { PlansService } from './plans.service';
import { SubscriptionsService } from './subscriptions.service';
import { EntitlementsService } from './entitlements.service';
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
}
