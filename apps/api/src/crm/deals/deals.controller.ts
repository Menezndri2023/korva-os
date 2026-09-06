import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createDealSchema,
  listDealsQuerySchema,
  loseDealSchema,
  moveDealStageSchema,
  updateDealSchema,
  type CreateDealInput,
  type ListDealsQuery,
  type LoseDealInput,
  type MoveDealStageInput,
  type UpdateDealInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { DealsService } from './deals.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('deals')
@RequireModule('crm')
@Controller('deals')
export class DealsController {
  constructor(private readonly dealsService: DealsService) {}

  @RequirePermissions('deals.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listDealsQuerySchema)) query: ListDealsQuery,
  ) {
    return this.dealsService.list(tenant.organizationId, query);
  }

  @RequirePermissions('deals.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.dealsService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('deals.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createDealSchema)) body: CreateDealInput,
  ) {
    return this.dealsService.create(tenant.organizationId, user.userId, body);
  }

  @RequirePermissions('deals.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDealSchema)) body: UpdateDealInput,
  ) {
    return this.dealsService.update(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }

  @RequirePermissions('deals.update')
  @Post(':id/move-stage')
  moveStage(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(moveDealStageSchema))
    body: MoveDealStageInput,
  ) {
    return this.dealsService.moveStage(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }

  @RequirePermissions('deals.update')
  @Post(':id/win')
  win(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.dealsService.win(tenant.organizationId, user.userId, id);
  }

  @RequirePermissions('deals.update')
  @Post(':id/lose')
  lose(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(loseDealSchema)) body: LoseDealInput,
  ) {
    return this.dealsService.lose(tenant.organizationId, user.userId, id, body);
  }

  @RequirePermissions('deals.update')
  @Post(':id/reopen')
  reopen(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.dealsService.reopen(tenant.organizationId, user.userId, id);
  }
}
