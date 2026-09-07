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
import { AuditModule } from '../audit/audit.module';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';

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
    ]),
    AuditModule,
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
