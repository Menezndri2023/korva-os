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
  createDiscountCodeSchema,
  listDiscountCodesQuerySchema,
  updateDiscountCodeSchema,
  type CreateDiscountCodeInput,
  type ListDiscountCodesQuery,
  type UpdateDiscountCodeInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { DiscountCodesService } from './discount-codes.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('discount-codes')
@RequireModule('finance')
@Controller('discount-codes')
export class DiscountCodesController {
  constructor(private readonly discountCodesService: DiscountCodesService) {}

  @RequirePermissions('discount_codes.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listDiscountCodesQuerySchema))
    query: ListDiscountCodesQuery,
  ) {
    return this.discountCodesService.list(tenant.organizationId, query);
  }

  @RequirePermissions('discount_codes.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.discountCodesService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('discount_codes.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createDiscountCodeSchema))
    body: CreateDiscountCodeInput,
  ) {
    return this.discountCodesService.create(tenant.organizationId, body);
  }

  @RequirePermissions('discount_codes.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateDiscountCodeSchema))
    body: UpdateDiscountCodeInput,
  ) {
    return this.discountCodesService.update(tenant.organizationId, id, body);
  }

  @RequirePermissions('discount_codes.delete')
  @Delete(':id')
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    await this.discountCodesService.delete(tenant.organizationId, id);
    return { deleted: true };
  }
}
