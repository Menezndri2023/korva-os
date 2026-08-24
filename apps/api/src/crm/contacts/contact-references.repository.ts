import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import {
  Order,
  OrderDocument,
} from '../../commerce/orders/schemas/order.schema';
import { Cart, CartDocument } from '../../commerce/carts/schemas/cart.schema';
import {
  Booking,
  BookingDocument,
} from '../../booking/bookings/schemas/booking.schema';
import {
  Invoice,
  InvoiceDocument,
} from '../../finance/invoices/schemas/invoice.schema';
import {
  Quote,
  QuoteDocument,
} from '../../finance/quotes/schemas/quote.schema';
import {
  Conversation,
  ConversationDocument,
} from '../../communication/conversations/schemas/conversation.schema';

/**
 * Every business entity with a required contactId, queried directly via @InjectModel rather
 * than through each entity's own repository/service — those live in modules that already
 * import CrmModule (Commerce, Booking, Finance and Communication all depend on Crm for
 * contacts/leads), so CrmModule importing them back would be a circular module dependency.
 * This repository has zero existing forwardRef() usage (see shared/email/email.module.ts) —
 * direct model injection is the same fix already used in subscriptions.service.ts for
 * Organization, to avoid introducing one here.
 */
@Injectable()
export class ContactReferencesRepository {
  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Cart.name) private readonly cartModel: Model<CartDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(Quote.name) private readonly quoteModel: Model<QuoteDocument>,
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
  ) {}

  /**
   * True if any business record still references this contact within this organization —
   * regardless of status (e.g. a cancelled order or a lost lead). contactId is a required,
   * non-nullable field on all seven schemas and none of them support a soft-delete/archival
   * state that would make an existing reference safe to orphan, so any match blocks deletion.
   */
  async hasAnyReference(
    organizationId: string,
    contactId: string,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(contactId)) return false;

    const filter = {
      organizationId: new Types.ObjectId(organizationId),
      contactId: new Types.ObjectId(contactId),
    };

    const results = await Promise.all([
      this.leadModel.exists(filter),
      this.orderModel.exists(filter),
      this.cartModel.exists(filter),
      this.bookingModel.exists(filter),
      this.invoiceModel.exists(filter),
      this.quoteModel.exists(filter),
      this.conversationModel.exists(filter),
    ]);

    return results.some((result) => Boolean(result));
  }
}
