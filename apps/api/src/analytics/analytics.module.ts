import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Lead, LeadSchema } from '../crm/leads/schemas/lead.schema';
import {
  Booking,
  BookingSchema,
} from '../booking/bookings/schemas/booking.schema';
import { Order, OrderSchema } from '../commerce/orders/schemas/order.schema';
import {
  Invoice,
  InvoiceSchema,
} from '../finance/invoices/schemas/invoice.schema';
import {
  Organization,
  OrganizationSchema,
} from '../organizations/schemas/organization.schema';
import { Offer, OfferSchema } from '../catalog/offers/schemas/offer.schema';
import {
  StockMovement,
  StockMovementSchema,
} from '../catalog/offers/schemas/stock-movement.schema';
import { Contact, ContactSchema } from '../crm/contacts/schemas/contact.schema';
import {
  Payment,
  PaymentSchema,
} from '../finance/payments/schemas/payment.schema';
import { AuditModule } from '../audit/audit.module';
// For MembershipsService (the Business network view). Safe: IdentityModule imports none of the
// modules that import AnalyticsModule (AI, BusinessGraph), nor AnalyticsModule itself.
import { IdentityModule } from '../identity/identity.module';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { ExportsService } from './exports.service';
import { ExportsController } from './exports.controller';
import { NetworkService } from './network.service';
import { NetworkController } from './network.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Lead.name, schema: LeadSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: Offer.name, schema: OfferSchema },
      { name: StockMovement.name, schema: StockMovementSchema },
      { name: Contact.name, schema: ContactSchema },
      { name: Payment.name, schema: PaymentSchema },
    ]),
    AuditModule,
    IdentityModule,
  ],
  controllers: [AnalyticsController, ExportsController, NetworkController],
  providers: [AnalyticsService, ExportsService, NetworkService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
