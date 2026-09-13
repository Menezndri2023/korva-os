import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type {
  BusinessGraphTimelineEntry,
  ContactTimeline,
  OrganizationGraphSummary,
} from '@korva/types';
import {
  Contact,
  ContactDocument,
} from '../crm/contacts/schemas/contact.schema';
import { Lead, LeadDocument } from '../crm/leads/schemas/lead.schema';
import { Deal, DealDocument } from '../crm/deals/schemas/deal.schema';
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
import {
  Supplier,
  SupplierDocument,
} from '../catalog/purchase-orders/schemas/supplier.schema';
import {
  PurchaseOrder,
  PurchaseOrderDocument,
} from '../catalog/purchase-orders/schemas/purchase-order.schema';
import { AnalyticsService } from '../analytics/analytics.service';

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
    @InjectModel(Deal.name) private readonly dealModel: Model<DealDocument>,
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
    @InjectModel(Supplier.name)
    private readonly supplierModel: Model<SupplierDocument>,
    @InjectModel(PurchaseOrder.name)
    private readonly purchaseOrderModel: Model<PurchaseOrderDocument>,
    private readonly analyticsService: AnalyticsService,
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

    const [leads, deals, quotes, invoices, bookings, orders, conversations] =
      await Promise.all([
        this.leadModel.find(byContact).lean(),
        this.dealModel.find(byContact).lean(),
        this.quoteModel.find(byContact).lean(),
        this.invoiceModel.find(byContact).lean(),
        this.bookingModel.find(byContact).lean(),
        this.orderModel.find(byContact).lean(),
        this.conversationModel.find(byContact).lean(),
      ]);

    const invoiceIds = invoices.map((invoice) => invoice._id);
    const leadIds = leads.map((lead) => lead._id);
    const dealIds = deals.map((deal) => deal._id);

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
            // Phase F1 — same reasoning as the deal timeline entries above: Deal is a valid
            // Task/Activity/Note entity since D1, so its tasks belong here too.
            ...(dealIds.length
              ? [{ entity: 'deal' as const, entityId: { $in: dealIds } }]
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
      // Phase F1 — Deal was split out of Lead in D1; without this, every deal a contact has
      // (their actual pipeline/value history) would be silently invisible on their timeline.
      ...deals.map((deal) => ({
        type: 'deal' as const,
        id: deal._id.toString(),
        occurredAt:
          (deal as { createdAt?: Date }).createdAt?.toISOString() ??
          new Date(0).toISOString(),
        status: deal.status,
        summary: `Affaire (${deal.status})`,
        amount: deal.estimatedValue,
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

  /**
   * Phase F1 (docs/KORVA_OS_V2_AUDIT.md §2.7) — the Business Graph's org-level counterpart to
   * the per-contact timeline above. Every number is a direct count/sum off existing documents,
   * never an estimate — the inventory fields specifically reuse AnalyticsService's own
   * getDeadStock/getReorderSuggestions rather than re-deriving those definitions here (see
   * BusinessGraphModule's own doc comment on why). Backs the global AI tool (F2).
   */
  async getOrganizationSummary(
    organizationId: string,
  ): Promise<OrganizationGraphSummary> {
    const organizationObjectId = new Types.ObjectId(organizationId);

    const [
      openLeadsCount,
      openDeals,
      overdueInvoices,
      deadStock,
      reorderSuggestions,
      supplierCount,
      pendingPurchaseOrdersCount,
    ] = await Promise.all([
      this.leadModel.countDocuments({
        organizationId: organizationObjectId,
        status: { $nin: ['converted', 'disqualified'] },
      }),
      this.dealModel
        .find({ organizationId: organizationObjectId, status: 'open' })
        .lean(),
      this.invoiceModel
        .find({ organizationId: organizationObjectId, status: 'overdue' })
        .lean(),
      this.analyticsService.getDeadStock(organizationId, 90),
      this.analyticsService.getReorderSuggestions(organizationId),
      this.supplierModel.countDocuments({
        organizationId: organizationObjectId,
      }),
      this.purchaseOrderModel.countDocuments({
        organizationId: organizationObjectId,
        status: 'ordered',
      }),
    ]);

    return {
      crm: {
        openLeadsCount,
        openDealsCount: openDeals.length,
        openDealsValue: openDeals.reduce(
          (sum, deal) => sum + (deal.estimatedValue ?? 0),
          0,
        ),
      },
      finance: {
        overdueInvoicesCount: overdueInvoices.length,
        overdueInvoicesTotal: overdueInvoices.reduce(
          (sum, invoice) =>
            sum + Math.max(0, invoice.total - invoice.amountPaid),
          0,
        ),
      },
      inventory: {
        lowStockCount: reorderSuggestions.length,
        deadStockCount: deadStock.length,
      },
      suppliers: {
        supplierCount,
        pendingPurchaseOrdersCount,
      },
    };
  }
}
