import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Offer, OfferSchema } from './offers/schemas/offer.schema';
import { OffersRepository } from './offers/offers.repository';
import { OffersService } from './offers/offers.service';
import { OffersController } from './offers/offers.controller';
import { OfferReferencesRepository } from './offers/offer-references.repository';
import { Category, CategorySchema } from './categories/schemas/category.schema';
import { CategoriesRepository } from './categories/categories.repository';
import { CategoriesService } from './categories/categories.service';
import { CategoriesController } from './categories/categories.controller';
import { CategoryReferencesRepository } from './categories/category-references.repository';
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
import { StorageModule } from '../shared/storage/storage.module';

@Module({
  imports: [
    // Order/Cart/Booking/Invoice/Quote registered here (not by importing
    // CommerceModule/BookingModule/FinanceModule) so OfferReferencesRepository can check for
    // references without a circular module dependency — those modules already import
    // CatalogModule for OffersService.getById(). Same fix as ContactReferencesRepository in
    // crm.module.ts (LOT F5).
    MongooseModule.forFeature([
      { name: Offer.name, schema: OfferSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Order.name, schema: OrderSchema },
      { name: Cart.name, schema: CartSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Quote.name, schema: QuoteSchema },
    ]),
    CustomFieldsModule,
    AuditModule,
    // Registers UploadsController (POST/GET/DELETE /uploads) — see storage.module.ts for why
    // it's imported here rather than directly in app.module.ts.
    StorageModule,
  ],
  controllers: [OffersController, CategoriesController],
  providers: [
    OffersRepository,
    OffersService,
    OfferReferencesRepository,
    CategoriesRepository,
    CategoriesService,
    CategoryReferencesRepository,
  ],
  exports: [OffersService, CategoriesService],
})
export class CatalogModule {}
