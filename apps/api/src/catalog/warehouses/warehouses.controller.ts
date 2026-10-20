import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createWarehouseSchema,
  updateWarehouseSchema,
  type CreateWarehouseInput,
  type UpdateWarehouseInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { WarehousesService } from './warehouses.service';
import { StockLevelsService } from './stock-levels.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePlanFeature } from '../../common/decorators/require-plan-feature.decorator';

@ApiTags('warehouses')
@RequireModule('catalog')
@Controller('warehouses')
export class WarehousesController {
  constructor(
    private readonly warehousesService: WarehousesService,
    private readonly stockLevelsService: StockLevelsService,
  ) {}

  @RequirePermissions('warehouses.create')
  @RequirePlanFeature('warehouses')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createWarehouseSchema))
    body: CreateWarehouseInput,
  ) {
    return this.warehousesService.create(tenant.organizationId, body);
  }

  @RequirePermissions('warehouses.read')
  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.warehousesService.list(tenant.organizationId);
  }

  @RequirePermissions('warehouses.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.warehousesService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('warehouses.update')
  @RequirePlanFeature('warehouses')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWarehouseSchema))
    body: UpdateWarehouseInput,
  ) {
    return this.warehousesService.update(tenant.organizationId, id, body);
  }

  @RequirePermissions('warehouses.delete')
  @Delete(':id')
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    await this.warehousesService.delete(tenant.organizationId, id);
    return { deleted: true };
  }

  /** Which offers currently have stock at this warehouse — backs a warehouse's own detail view. */
  @RequirePermissions('warehouses.read')
  @Get(':id/stock-levels')
  listStockLevelsForWarehouse(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    return this.stockLevelsService.listForWarehouse(tenant.organizationId, id);
  }
}
