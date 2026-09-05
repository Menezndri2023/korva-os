import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PublicService } from './public.service';
import { PublicController } from './public.controller';
import { OrganizationsModule } from '../organizations/organizations.module';
import { CatalogModule } from '../catalog/catalog.module';
import { BookingModule } from '../booking/booking.module';
import { CommerceModule } from '../commerce/commerce.module';
import { CrmModule } from '../crm/crm.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { FinanceModule } from '../finance/finance.module';
import { IntegrationsModule } from '../integrations/integrations.module';
import { EmailModule } from '../shared/email/email.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { Order, OrderSchema } from '../commerce/orders/schemas/order.schema';
import {
  Booking,
  BookingSchema,
} from '../booking/bookings/schemas/booking.schema';
import { Contact, ContactSchema } from '../crm/contacts/schemas/contact.schema';

@Module({
  imports: [
    OrganizationsModule,
    CatalogModule,
    BookingModule,
    CommerceModule,
    CrmModule,
    SubscriptionsModule,
    FinanceModule,
    IntegrationsModule,
    EmailModule,
    ReviewsModule,
    // CommerceModule/BookingModule/CrmModule only export their *Service classes, not their
    // repositories, so the order/booking-tracking lookups below (a read-only, email-gated
    // lookup by number/id that has no equivalent method on OrdersService/BookingsService) need
    // their own direct model access. Same fix CrmModule itself already uses for Order/Cart/
    // Booking/Invoice/Quote/Conversation (see crm.module.ts) — registering the schema again
    // here is safe: Mongoose binds every registration to the same underlying collection.
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Contact.name, schema: ContactSchema },
    ]),
  ],
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
