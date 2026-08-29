import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Contact, ContactSchema } from '../crm/contacts/schemas/contact.schema';
import { Lead, LeadSchema } from '../crm/leads/schemas/lead.schema';
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
import { BusinessGraphService } from './business-graph.service';
import { BusinessGraphController } from './business-graph.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Contact.name, schema: ContactSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: Task.name, schema: TaskSchema },
      { name: Quote.name, schema: QuoteSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Conversation.name, schema: ConversationSchema },
    ]),
  ],
  controllers: [BusinessGraphController],
  providers: [BusinessGraphService],
})
export class BusinessGraphModule {}
