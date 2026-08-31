import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Cart, CartSchema } from './carts/schemas/cart.schema';
import { Order, OrderSchema } from './orders/schemas/order.schema';
import {
  Fulfillment,
  FulfillmentSchema,
} from './fulfillments/schemas/fulfillment.schema';

import { CartsRepository } from './carts/carts.repository';
import { CartsService } from './carts/carts.service';
import { CartsController } from './carts/carts.controller';

import { OrdersRepository } from './orders/orders.repository';
import { OrdersService } from './orders/orders.service';
import { OrdersController } from './orders/orders.controller';

import { FulfillmentsRepository } from './fulfillments/fulfillments.repository';
import { FulfillmentsService } from './fulfillments/fulfillments.service';
import { FulfillmentsController } from './fulfillments/fulfillments.controller';

import {
  ReturnRequest,
  ReturnRequestSchema,
} from './returns/schemas/return-request.schema';
import { ReturnRequestsRepository } from './returns/return-requests.repository';
import { ReturnRequestsService } from './returns/return-requests.service';
import { ReturnRequestsController } from './returns/return-requests.controller';

import {
  WishlistItem,
  WishlistItemSchema,
} from './wishlist/schemas/wishlist-item.schema';
import { WishlistRepository } from './wishlist/wishlist.repository';
import { WishlistService } from './wishlist/wishlist.service';

import { CrmModule } from '../crm/crm.module';
import { CatalogModule } from '../catalog/catalog.module';
import { BookingModule } from '../booking/booking.module';
import { FinanceModule } from '../finance/finance.module';
import { CountersModule } from '../core/counters/counters.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Cart.name, schema: CartSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Fulfillment.name, schema: FulfillmentSchema },
      { name: ReturnRequest.name, schema: ReturnRequestSchema },
      { name: WishlistItem.name, schema: WishlistItemSchema },
    ]),
    CrmModule,
    CatalogModule,
    BookingModule,
    FinanceModule,
    CountersModule,
    AuditModule,
  ],
  controllers: [
    CartsController,
    OrdersController,
    FulfillmentsController,
    ReturnRequestsController,
  ],
  providers: [
    CartsRepository,
    CartsService,
    OrdersRepository,
    OrdersService,
    FulfillmentsRepository,
    FulfillmentsService,
    ReturnRequestsRepository,
    ReturnRequestsService,
    WishlistRepository,
    WishlistService,
  ],
  exports: [OrdersService, ReturnRequestsService, WishlistService],
})
export class CommerceModule {}
