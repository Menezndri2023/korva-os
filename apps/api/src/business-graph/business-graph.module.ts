import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Contact, ContactSchema } from '../crm/contacts/schemas/contact.schema';
import { Lead, LeadSchema } from '../crm/leads/schemas/lead.schema';
import { Deal, DealSchema } from '../crm/deals/schemas/deal.schema';
import { Task, TaskSchema } from '../crm/tasks/schemas/task.schema';
import { Quote, QuoteSchema } from '../finance/quotes/schemas/quote.schema';
import {
  Invoice,
  InvoiceSchema,
} from '../finance/invoices/schemas/invoice.schema';
import {
  Payment,
  PaymentSchema,
} from '../finance/payments/schemas/payment.schema';
import {
  Booking,
  BookingSchema,
} from '../booking/bookings/schemas/booking.schema';
import { Order, OrderSchema } from '../commerce/orders/schemas/order.schema';
import {
  Conversation,
  ConversationSchema,
} from '../communication/conversations/schemas/conversation.schema';
import {
  Supplier,
  SupplierSchema,
} from '../catalog/purchase-orders/schemas/supplier.schema';
import {
  PurchaseOrder,
  PurchaseOrderSchema,
} from '../catalog/purchase-orders/schemas/purchase-order.schema';
import { AnalyticsModule } from '../analytics/analytics.module';
import { BusinessGraphService } from './business-graph.service';
import { BusinessGraphController } from './business-graph.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Contact.name, schema: ContactSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: Deal.name, schema: DealSchema },
      { name: Task.name, schema: TaskSchema },
      { name: Quote.name, schema: QuoteSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Conversation.name, schema: ConversationSchema },
      // Phase F1 — Supplier/PurchaseOrder registered directly (same reasoning as every other
      // schema here: a read projection, never a second source of truth) rather than importing
      // CatalogModule, which would pull in its full provider graph for 2 raw counts.
      { name: Supplier.name, schema: SupplierSchema },
      { name: PurchaseOrder.name, schema: PurchaseOrderSchema },
    ]),
    // Phase F1 — the inventory half of getOrganizationSummary reuses AnalyticsService's own
    // already-authoritative getDeadStock/getReorderSuggestions definitions rather than
    // re-deriving them from raw StockMovement/Offer queries here, unlike the CRM/Finance/
    // Supplier counts above which are simple enough to stay a direct projection.
    AnalyticsModule,
  ],
  controllers: [BusinessGraphController],
  providers: [BusinessGraphService],
  // Phase F2 — AiModule's new global AI tool needs getOrganizationSummary.
  exports: [BusinessGraphService],
})
export class BusinessGraphModule {}
