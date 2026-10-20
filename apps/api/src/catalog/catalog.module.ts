import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Offer, OfferSchema } from './offers/schemas/offer.schema';
import {
  StockMovement,
  StockMovementSchema,
} from './offers/schemas/stock-movement.schema';
import { OffersRepository } from './offers/offers.repository';
import { StockMovementsRepository } from './offers/stock-movements.repository';
import { OffersService } from './offers/offers.service';
import { OffersController } from './offers/offers.controller';
import { InventoryService } from './offers/inventory.service';
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
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { StorageModule } from '../shared/storage/storage.module';
import {
  Supplier,
  SupplierSchema,
} from './purchase-orders/schemas/supplier.schema';
import {
  PurchaseOrder,
  PurchaseOrderSchema,
} from './purchase-orders/schemas/purchase-order.schema';
import { SuppliersRepository } from './purchase-orders/suppliers.repository';
import { SuppliersService } from './purchase-orders/suppliers.service';
import { SuppliersController } from './purchase-orders/suppliers.controller';
import { PurchaseOrdersRepository } from './purchase-orders/purchase-orders.repository';
import { PurchaseOrdersService } from './purchase-orders/purchase-orders.service';
import { PurchaseOrdersController } from './purchase-orders/purchase-orders.controller';
import {
  Warehouse,
  WarehouseSchema,
} from './warehouses/schemas/warehouse.schema';
import {
  StockLevel,
  StockLevelSchema,
} from './warehouses/schemas/stock-level.schema';
import { WarehousesRepository } from './warehouses/warehouses.repository';
import { WarehousesService } from './warehouses/warehouses.service';
import { WarehousesController } from './warehouses/warehouses.controller';
import { StockLevelsRepository } from './warehouses/stock-levels.repository';
import { StockLevelsService } from './warehouses/stock-levels.service';

@Module({
  imports: [
    // Order/Cart/Booking/Invoice/Quote registered here (not by importing
    // CommerceModule/BookingModule/FinanceModule) so OfferReferencesRepository can check for
    // references without a circular module dependency — those modules already import
    // CatalogModule for OffersService.getById(). Same fix as ContactReferencesRepository in
    // crm.module.ts (LOT F5).
    MongooseModule.forFeature([
      { name: Offer.name, schema: OfferSchema },
      { name: StockMovement.name, schema: StockMovementSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Order.name, schema: OrderSchema },
      { name: Cart.name, schema: CartSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Quote.name, schema: QuoteSchema },
      { name: Supplier.name, schema: SupplierSchema },
      { name: PurchaseOrder.name, schema: PurchaseOrderSchema },
      { name: Warehouse.name, schema: WarehouseSchema },
      { name: StockLevel.name, schema: StockLevelSchema },
    ]),
    CustomFieldsModule,
    AuditModule,
    SubscriptionsModule,
    // Registers UploadsController (POST/GET/DELETE /uploads) — see storage.module.ts for why
    // it's imported here rather than directly in app.module.ts.
    StorageModule,
  ],
  controllers: [
    OffersController,
    CategoriesController,
    SuppliersController,
    PurchaseOrdersController,
    WarehousesController,
  ],
  providers: [
    OffersRepository,
    StockMovementsRepository,
    OffersService,
    InventoryService,
    OfferReferencesRepository,
    CategoriesRepository,
    CategoriesService,
    CategoryReferencesRepository,
    SuppliersRepository,
    SuppliersService,
    PurchaseOrdersRepository,
    PurchaseOrdersService,
    WarehousesRepository,
    WarehousesService,
    StockLevelsRepository,
    StockLevelsService,
  ],
  exports: [
    OffersService,
    InventoryService,
    CategoriesService,
    PurchaseOrdersService,
  ],
})
export class CatalogModule {}
