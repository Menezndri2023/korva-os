import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  topUpCreditBalanceSchema,
  listCreditBalancesQuerySchema,
  type TopUpCreditBalanceInput,
  type ListCreditBalancesQuery,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { CreditBalancesService } from './credit-balances.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('credit-balances')
@RequireModule('booking')
@Controller('credit-balances')
export class CreditBalancesController {
  constructor(private readonly creditBalancesService: CreditBalancesService) {}

  @RequirePermissions('credit_balances.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listCreditBalancesQuerySchema))
    query: ListCreditBalancesQuery,
  ) {
    return this.creditBalancesService.list(tenant.organizationId, query);
  }

  @RequirePermissions('credit_balances.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.creditBalancesService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('credit_balances.create')
  @Post('top-up')
  topUp(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(topUpCreditBalanceSchema))
    body: TopUpCreditBalanceInput,
  ) {
    return this.creditBalancesService.topUp(
      tenant.organizationId,
      user.userId,
      body,
    );
  }
}
