import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
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

import {
  KitchenTicket,
  KitchenTicketSchema,
} from './kitchen/schemas/kitchen-ticket.schema';
import { KitchenTicketsRepository } from './kitchen/kitchen-tickets.repository';
import { KitchenTicketsService } from './kitchen/kitchen-tickets.service';
import { KitchenTicketsController } from './kitchen/kitchen-tickets.controller';
import { KitchenGateway } from './kitchen/kitchen.gateway';
import { AbandonedCartReminderSchedulerService } from './carts/abandoned-cart-reminder-scheduler.service';

import { CrmModule } from '../crm/crm.module';
import { CatalogModule } from '../catalog/catalog.module';
import { BookingModule } from '../booking/booking.module';
import { FinanceModule } from '../finance/finance.module';
import { CountersModule } from '../core/counters/counters.module';
import { AuditModule } from '../audit/audit.module';
// Both imported solely for AbandonedCartReminderSchedulerService (org name in the recovery
// message, WhatsApp/email send) — verified no reverse edge back to CommerceModule from either,
// same discipline as the IdentityModule edge above.
import { OrganizationsModule } from '../organizations/organizations.module';
import { CommunicationModule } from '../communication/communication.module';
// For MembershipsService (KitchenGateway's WebSocket handshake auth — see its own doc comment)
// — safe: IdentityModule has no import path back to CommerceModule, verified by grepping every
// `import { CommerceModule }` site before adding this edge.
import { IdentityModule } from '../identity/identity.module';

import { ReviewsModule } from '../reviews/reviews.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Cart.name, schema: CartSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Fulfillment.name, schema: FulfillmentSchema },
      { name: ReturnRequest.name, schema: ReturnRequestSchema },
      { name: WishlistItem.name, schema: WishlistItemSchema },
      { name: KitchenTicket.name, schema: KitchenTicketSchema },
    ]),
    CrmModule,
    CatalogModule,
    BookingModule,
    FinanceModule,
    CountersModule,
    AuditModule,
    IdentityModule,
    OrganizationsModule,
    CommunicationModule,
    // ReviewRequestsService ("donnez votre avis" once an order is delivered). ReviewsModule only
    // imports CommunicationModule/CrmModule — no path back to CommerceModule.
    ReviewsModule,
    // A second, module-local JwtModule registration for KitchenGateway's own JwtService
    // injection — deliberately NOT exported (see this module's own `exports` array below), so
    // it can never collide with CustomerAuthModule's separately-registered JwtService (a
    // different secret, CUSTOMER_JWT_SECRET) even though CustomerAuthModule also imports this
    // module. Mirrors CustomerAuthModule's own isolated JwtModule.registerAsync exactly — see
    // its class doc for why two independently-secreted JwtService instances must never be
    // reachable from the same resolution scope. (A first attempt instead re-exported
    // IdentityModule's own JwtModule, which — because CustomerAuthModule already imports
    // IdentityModule directly too — put two same-token JwtService providers in reach of the
    // same module and broke customer-portal JWT verification; confirmed via e2e failures, not
    // theorized. Don't repeat that.)
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [
    CartsController,
    OrdersController,
    FulfillmentsController,
    ReturnRequestsController,
    KitchenTicketsController,
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
    KitchenTicketsRepository,
    KitchenTicketsService,
    KitchenGateway,
    AbandonedCartReminderSchedulerService,
  ],
  exports: [
    OrdersService,
    ReturnRequestsService,
    WishlistService,
    CartsService,
  ],
})
export class CommerceModule {}
