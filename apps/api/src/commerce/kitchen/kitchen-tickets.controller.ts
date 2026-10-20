import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { KITCHEN_TICKET_STATUSES } from '@korva/types';
import type { KitchenTicketStatus, TenantContext } from '@korva/types';
import { KitchenTicketsService } from './kitchen-tickets.service';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { RequirePlanFeature } from '../../common/decorators/require-plan-feature.decorator';

function parseStatus(value?: string): KitchenTicketStatus | undefined {
  return KITCHEN_TICKET_STATUSES.find((status) => status === value);
}

@ApiTags('kitchen')
@RequireModule('commerce')
// The kitchen screen is a Starter feature (PLAN_FEATURE_MIN_PLAN.kitchen_display).
@RequirePlanFeature('kitchen_display')
@Controller('kitchen-tickets')
export class KitchenTicketsController {
  constructor(private readonly kitchenTicketsService: KitchenTicketsService) {}

  @RequirePermissions('orders.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query('status') status?: string,
  ) {
    return this.kitchenTicketsService.list(
      tenant.organizationId,
      parseStatus(status),
    );
  }

  @RequirePermissions('orders.update')
  @Post(':id/advance')
  advance(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.kitchenTicketsService.advance(
      tenant.organizationId,
      user.userId,
      id,
    );
  }
}
