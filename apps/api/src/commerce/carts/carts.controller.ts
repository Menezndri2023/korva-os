import {
  BadRequestException,
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
  addCartItemSchema,
  updateCartItemSchema,
  type AddCartItemInput,
  type UpdateCartItemInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { CartsService } from './carts.service';
import { OrdersService } from '../orders/orders.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

@ApiTags('carts')
@Controller('carts')
export class CartsController {
  constructor(
    private readonly cartsService: CartsService,
    private readonly ordersService: OrdersService,
  ) {}

  @RequirePermissions('orders.create')
  @Get()
  getOrCreate(
    @CurrentTenant() tenant: TenantContext,
    @Query('contactId') contactId: string,
  ) {
    if (!contactId) {
      throw new BadRequestException({
        code: 'CONTACT_ID_REQUIRED',
        message: 'contactId query param is required',
      });
    }
    return this.cartsService.getOrCreateForContact(
      tenant.organizationId,
      contactId,
    );
  }

  @RequirePermissions('orders.create')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.cartsService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('orders.create')
  @Post(':id/items')
  addItem(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addCartItemSchema)) body: AddCartItemInput,
  ) {
    return this.cartsService.addItem(tenant.organizationId, id, body);
  }

  @RequirePermissions('orders.create')
  @Patch(':id/items/:itemId')
  updateItem(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(updateCartItemSchema))
    body: UpdateCartItemInput,
  ) {
    return this.cartsService.updateItem(
      tenant.organizationId,
      id,
      itemId,
      body,
    );
  }

  @RequirePermissions('orders.create')
  @Delete(':id/items/:itemId')
  removeItem(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Param('itemId') itemId: string,
  ) {
    return this.cartsService.removeItem(tenant.organizationId, id, itemId);
  }

  @RequirePermissions('orders.create')
  @Post(':id/checkout')
  checkout(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ordersService.createFromCart(
      tenant.organizationId,
      user.userId,
      id,
    );
  }
}
