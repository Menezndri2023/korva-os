import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { BusinessGraphTimelineEntry, ContactTimeline } from '@korva/types';
import {
  Contact,
  ContactDocument,
} from '../crm/contacts/schemas/contact.schema';
import { Lead, LeadDocument } from '../crm/leads/schemas/lead.schema';
import { Task, TaskDocument } from '../crm/tasks/schemas/task.schema';
import { Quote, QuoteDocument } from '../finance/quotes/schemas/quote.schema';
import {
  Invoice,
  InvoiceDocument,
} from '../finance/invoices/schemas/invoice.schema';
import {
  Payment,
  PaymentDocument,
} from '../finance/payments/schemas/payment.schema';
import {
  Booking,
  BookingDocument,
} from '../booking/bookings/schemas/booking.schema';
import { Order, OrderDocument } from '../commerce/orders/schemas/order.schema';
import {
  Conversation,
  ConversationDocument,
} from '../communication/conversations/schemas/conversation.schema';

/**
 * The "Business Graph" read layer: every module already cross-references Contact by
 * ObjectId (Lead/Quote/Invoice/Booking/Order/Conversation all carry a contactId, Payment
 * carries invoiceId one hop away, Task carries a polymorphic entity/entityId). Nothing here
 * is a new source of truth — it's a projection assembled from documents that already exist,
 * the same cross-module direct-model-injection pattern AnalyticsService already uses for
 * org-wide aggregates, applied instead to a single contact's full history.
 */
@Injectable()
export class BusinessGraphService {
  constructor(
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(Quote.name) private readonly quoteModel: Model<QuoteDocument>,
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
  ) {}

  async getContactTimeline(
    organizationId: string,
    contactId: string,
  ): Promise<ContactTimeline> {
    const organizationObjectId = new Types.ObjectId(organizationId);
    const contactObjectId = new Types.ObjectId(contactId);

    const contact = await this.contactModel
      .findOne({ _id: contactObjectId, organizationId: organizationObjectId })
      .lean();
    if (!contact) {
      throw new NotFoundException({
        code: 'CONTACT_NOT_FOUND',
        message: 'Contact not found',
      });
    }

    const byContact = {
      organizationId: organizationObjectId,
      contactId: contactObjectId,
    };

    const [leads, quotes, invoices, bookings, orders, conversations] =
      await Promise.all([
        this.leadModel.find(byContact).lean(),
        this.quoteModel.find(byContact).lean(),
        this.invoiceModel.find(byContact).lean(),
        this.bookingModel.find(byContact).lean(),
        this.orderModel.find(byContact).lean(),
        this.conversationModel.find(byContact).lean(),
      ]);

    const invoiceIds = invoices.map((invoice) => invoice._id);
    const leadIds = leads.map((lead) => lead._id);

    const [payments, tasks] = await Promise.all([
      invoiceIds.length
        ? this.paymentModel
            .find({
              organizationId: organizationObjectId,
              invoiceId: { $in: invoiceIds },
            })
            .lean()
        : Promise.resolve([]),
      this.taskModel
        .find({
          organizationId: organizationObjectId,
          $or: [
            { entity: 'contact', entityId: contactObjectId },
            ...(leadIds.length
              ? [{ entity: 'lead' as const, entityId: { $in: leadIds } }]
              : []),
          ],
        })
        .lean(),
    ]);

    const entries: BusinessGraphTimelineEntry[] = [
      ...leads.map((lead) => ({
        type: 'lead' as const,
        id: lead._id.toString(),
        occurredAt:
          (lead as { createdAt?: Date }).createdAt?.toISOString() ??
          new Date(0).toISOString(),
        status: lead.status,
        summary: `Lead (${lead.status})`,
      })),
      ...quotes.map((quote) => ({
        type: 'quote' as const,
        id: quote._id.toString(),
        occurredAt:
          (quote as { createdAt?: Date }).createdAt?.toISOString() ??
          new Date(0).toISOString(),
        status: quote.status,
        summary: `Devis ${quote.number} (${quote.status})`,
        amount: quote.total,
        currency: quote.currency,
      })),
      ...invoices.map((invoice) => ({
        type: 'invoice' as const,
        id: invoice._id.toString(),
        occurredAt:
          (invoice as { createdAt?: Date }).createdAt?.toISOString() ??
          new Date(0).toISOString(),
        status: invoice.status,
        summary: `Facture ${invoice.number} (${invoice.status})`,
        amount: invoice.total,
        currency: invoice.currency,
      })),
      ...payments.map((payment) => ({
        type: 'payment' as const,
        id: payment._id.toString(),
        occurredAt:
          (payment as { createdAt?: Date }).createdAt?.toISOString() ??
          new Date(0).toISOString(),
        status: payment.status,
        summary: `Paiement (${payment.status})`,
        amount: payment.amount,
        currency: payment.currency,
      })),
      ...bookings.map((booking) => ({
        type: 'booking' as const,
        id: booking._id.toString(),
        occurredAt: booking.startAt.toISOString(),
        status: booking.status,
        summary: `Réservation (${booking.status})`,
        amount: booking.pricing.amount,
        currency: booking.pricing.currency,
      })),
      ...orders.map((order) => ({
        type: 'order' as const,
        id: order._id.toString(),
        occurredAt:
          (order as { createdAt?: Date }).createdAt?.toISOString() ??
          new Date(0).toISOString(),
        status: order.status,
        summary: `Commande ${order.number} (${order.status})`,
        amount: order.total,
        currency: order.currency,
      })),
      ...conversations.map((conversation) => ({
        type: 'conversation' as const,
        id: conversation._id.toString(),
        occurredAt: (
          conversation.lastMessageAt ??
          (conversation as { createdAt?: Date }).createdAt ??
          new Date(0)
        ).toISOString(),
        status: conversation.status,
        summary: conversation.subject
          ? `Conversation (${conversation.channel}) — ${conversation.subject}`
          : `Conversation (${conversation.channel})`,
      })),
      ...tasks.map((task) => ({
        type: 'task' as const,
        id: task._id.toString(),
        occurredAt:
          (task as { createdAt?: Date }).createdAt?.toISOString() ??
          new Date(0).toISOString(),
        status: task.status,
        summary: task.title,
      })),
    ];

    entries.sort(
      (a, b) =>
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );

    return { contactId, entries };
  }
}
