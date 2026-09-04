import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createPurchaseOrderSchema,
  listPurchaseOrdersQuerySchema,
  type CreatePurchaseOrderInput,
  type ListPurchaseOrdersQuery,
} from '@korva/validation';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import type { TenantContext } from '@korva/types';
import { PurchaseOrdersService } from './purchase-orders.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('purchase-orders')
@RequireModule('catalog')
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  @RequirePermissions('purchase_orders.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createPurchaseOrderSchema))
    body: CreatePurchaseOrderInput,
  ) {
    return this.purchaseOrdersService.create(
      tenant.organizationId,
      user.userId,
      body,
    );
  }

  @RequirePermissions('purchase_orders.read')
  @Get()
  findAll(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listPurchaseOrdersQuerySchema))
    query: ListPurchaseOrdersQuery,
  ) {
    return this.purchaseOrdersService.findAll(tenant.organizationId, query);
  }

  @RequirePermissions('purchase_orders.read')
  @Get(':id')
  findOne(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.purchaseOrdersService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('purchase_orders.update')
  @Post(':id/mark-ordered')
  markOrdered(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.purchaseOrdersService.markOrdered(
      tenant.organizationId,
      user.userId,
      id,
    );
  }

  @RequirePermissions('purchase_orders.receive')
  @Post(':id/receive')
  receive(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.purchaseOrdersService.receive(
      tenant.organizationId,
      user.userId,
      id,
    );
  }

  @RequirePermissions('purchase_orders.cancel')
  @Post(':id/cancel')
  cancel(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.purchaseOrdersService.cancel(
      tenant.organizationId,
      user.userId,
      id,
    );
  }
}
