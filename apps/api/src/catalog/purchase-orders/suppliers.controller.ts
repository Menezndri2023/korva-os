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
  createSupplierSchema,
  listSuppliersQuerySchema,
  updateSupplierSchema,
  type CreateSupplierInput,
  type ListSuppliersQuery,
  type UpdateSupplierInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { SuppliersService } from './suppliers.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { RequirePlanFeature } from '../../common/decorators/require-plan-feature.decorator';

@ApiTags('suppliers')
@RequireModule('catalog')
@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliersService: SuppliersService) {}

  @RequirePermissions('suppliers.create')
  @RequirePlanFeature('suppliers')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createSupplierSchema))
    body: CreateSupplierInput,
  ) {
    return this.suppliersService.create(tenant.organizationId, body);
  }

  @RequirePermissions('suppliers.read')
  @Get()
  findAll(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listSuppliersQuerySchema))
    query: ListSuppliersQuery,
  ) {
    return this.suppliersService.findAll(tenant.organizationId, query);
  }

  @RequirePermissions('suppliers.read')
  @Get(':id')
  findOne(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.suppliersService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('suppliers.update')
  @RequirePlanFeature('suppliers')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSupplierSchema))
    body: UpdateSupplierInput,
  ) {
    return this.suppliersService.update(tenant.organizationId, id, body);
  }

  @RequirePermissions('suppliers.delete')
  @Delete(':id')
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    await this.suppliersService.delete(tenant.organizationId, id);
    return { deleted: true };
  }
}
