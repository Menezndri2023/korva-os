import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Offer, OfferSchema } from './offers/schemas/offer.schema';
import { OffersRepository } from './offers/offers.repository';
import { OffersService } from './offers/offers.service';
import { OffersController } from './offers/offers.controller';
import { OfferReferencesRepository } from './offers/offer-references.repository';
import { Order, OrderSchema } from '../commerce/orders/schemas/order.schema';
import { Cart, CartSchema } from '../commerce/carts/schemas/cart.schema';
import {
  Booking,
  BookingSchema,
} from '../booking/bookings/schemas/booking.schema';
import {
  Invoice,
  InvoiceSchema,
} from '../finance/invoices/schemas/invoice.schema';
import { Quote, QuoteSchema } from '../finance/quotes/schemas/quote.schema';
import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    // Order/Cart/Booking/Invoice/Quote registered here (not by importing
    // CommerceModule/BookingModule/FinanceModule) so OfferReferencesRepository can check for
    // references without a circular module dependency — those modules already import
    // CatalogModule for OffersService.getById(). Same fix as ContactReferencesRepository in
    // crm.module.ts (LOT F5).
    MongooseModule.forFeature([
      { name: Offer.name, schema: OfferSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Cart.name, schema: CartSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Quote.name, schema: QuoteSchema },
    ]),
    CustomFieldsModule,
    AuditModule,
  ],
  controllers: [OffersController],
  providers: [OffersRepository, OffersService, OfferReferencesRepository],
  exports: [OffersService],
})
export class CatalogModule {}
