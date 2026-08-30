import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  addOrderItemSchema,
  createOpenOrderSchema,
  createOrderFromBookingSchema,
  createOrderSchema,
  listOrdersQuerySchema,
  type AddOrderItemInput,
  type CreateOpenOrderInput,
  type CreateOrderFromBookingInput,
  type CreateOrderInput,
  type ListOrdersQuery,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { OrdersService } from './orders.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('orders')
@RequireModule('commerce')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @RequirePermissions('orders.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listOrdersQuerySchema)) query: ListOrdersQuery,
  ) {
    return this.ordersService.list(tenant.organizationId, query);
  }

  @RequirePermissions('orders.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.ordersService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('orders.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderInput,
  ) {
    return this.ordersService.create(tenant.organizationId, user.userId, body);
  }

  @RequirePermissions('orders.create', 'bookings.read')
  @Post('from-booking')
  createFromBooking(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createOrderFromBookingSchema))
    body: CreateOrderFromBookingInput,
  ) {
    return this.ordersService.createFromBooking(
      tenant.organizationId,
      user.userId,
      body.bookingId,
    );
  }

  @RequirePermissions('orders.create')
  @Post('open')
  createOpen(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createOpenOrderSchema))
    body: CreateOpenOrderInput,
  ) {
    return this.ordersService.createOpen(
      tenant.organizationId,
      user.userId,
      body,
    );
  }

  @RequirePermissions('orders.update')
  @Post(':id/items')
  addItem(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addOrderItemSchema)) body: AddOrderItemInput,
  ) {
    return this.ordersService.addItem(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }

  @RequirePermissions('orders.update')
  @Delete(':id/items/:index')
  removeItem(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
  ) {
    return this.ordersService.removeItem(
      tenant.organizationId,
      user.userId,
      id,
      index,
    );
  }

  @RequirePermissions('orders.update')
  @Post(':id/close')
  close(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ordersService.close(tenant.organizationId, user.userId, id);
  }

  @RequirePermissions('orders.update')
  @Post(':id/confirm')
  confirm(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ordersService.confirm(tenant.organizationId, user.userId, id);
  }

  @RequirePermissions('orders.cancel')
  @Post(':id/cancel')
  cancel(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ordersService.cancel(tenant.organizationId, user.userId, id);
  }

  @RequirePermissions('orders.update')
  @Post(':id/fulfill')
  fulfill(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ordersService.fulfill(tenant.organizationId, user.userId, id);
  }

  @RequirePermissions('orders.update', 'invoices.create')
  @Post(':id/generate-invoice')
  generateInvoice(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ordersService.generateInvoice(
      tenant.organizationId,
      user.userId,
      id,
    );
  }
}
