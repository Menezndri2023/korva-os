import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  adjustStockSchema,
  createOfferSchema,
  listOffersQuerySchema,
  updateOfferSchema,
  type AdjustStockInput,
  type CreateOfferInput,
  type ListOffersQuery,
  type UpdateOfferInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { OffersService } from './offers.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('offers')
@RequireModule('catalog')
@Controller('offers')
export class OffersController {
  constructor(private readonly offersService: OffersService) {}

  @RequirePermissions('offers.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listOffersQuerySchema)) query: ListOffersQuery,
  ) {
    return this.offersService.list(tenant.organizationId, query);
  }

  @RequirePermissions('offers.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.offersService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('offers.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createOfferSchema)) body: CreateOfferInput,
  ) {
    return this.offersService.create(tenant.organizationId, user.userId, body);
  }

  @RequirePermissions('offers.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateOfferSchema)) body: UpdateOfferInput,
  ) {
    return this.offersService.update(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }

  @RequirePermissions('offers.update')
  @Post(':id/stock/adjust')
  adjustStock(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(adjustStockSchema)) body: AdjustStockInput,
  ) {
    return this.offersService.adjustStock(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }

  @RequirePermissions('offers.delete')
  @Delete(':id')
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.offersService.delete(tenant.organizationId, user.userId, id);
    return { deleted: true };
  }
}
