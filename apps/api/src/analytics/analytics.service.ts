import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type {
  AnalyticsActivityEntry,
  AnalyticsOverview,
  AnalyticsRevenuePoint,
  AnalyticsRevenueTimeseries,
  InvoiceStatus,
  LeadStatus,
  OrderStatus,
} from '@korva/types';
import type { AnalyticsRevenueQuery } from '@korva/validation';
import { Lead, LeadDocument } from '../crm/leads/schemas/lead.schema';
import {
  Booking,
  BookingDocument,
} from '../booking/bookings/schemas/booking.schema';
import { Order, OrderDocument } from '../commerce/orders/schemas/order.schema';
import {
  Invoice,
  InvoiceDocument,
} from '../finance/invoices/schemas/invoice.schema';
import {
  Organization,
  OrganizationDocument,
} from '../organizations/schemas/organization.schema';
import { AuditService } from '../audit/audit.service';

/** Orders only count as revenue once the sale is real — matches the AI module's
 *  get_sales_report tool, the only other place this business rule already exists. */
const REVENUE_ORDER_STATUSES: OrderStatus[] = ['confirmed', 'fulfilled'];
/** Invoices still owed money — excludes draft (not yet sent) and cancelled/paid. */
const OUTSTANDING_INVOICE_STATUSES: InvoiceStatus[] = [
  'issued',
  'partially_paid',
  'overdue',
];

type StatusCount<S extends string> = { _id: S; count: number };

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
    private readonly auditService: AuditService,
  ) {}

  async getOverview(
    organizationId: string,
    from?: string,
    to?: string,
  ): Promise<AnalyticsOverview> {
    const organizationObjectId = new Types.ObjectId(organizationId);
    const createdAt = dateRangeMatch(from, to);
    const baseMatch = {
      organizationId: organizationObjectId,
      ...(createdAt ? { createdAt } : {}),
    };

    const [
      organization,
      leadsByStatus,
      bookingsTotal,
      bookingsUpcoming,
      ordersByStatus,
      revenueRows,
      invoicesByStatus,
      outstandingRows,
    ] = await Promise.all([
      this.organizationModel.findById(organizationObjectId).lean(),
      this.leadModel.aggregate<StatusCount<LeadStatus>>([
        { $match: baseMatch },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      this.bookingModel.countDocuments(baseMatch),
      this.bookingModel.countDocuments({
        organizationId: organizationObjectId,
        startAt: { $gte: new Date() },
        status: { $in: ['pending', 'confirmed'] },
      }),
      this.orderModel.aggregate<StatusCount<OrderStatus>>([
        { $match: baseMatch },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      this.orderModel.aggregate<{ revenue: number }>([
        {
          $match: { ...baseMatch, status: { $in: REVENUE_ORDER_STATUSES } },
        },
        { $group: { _id: null, revenue: { $sum: '$total' } } },
      ]),
      this.invoiceModel.aggregate<StatusCount<InvoiceStatus>>([
        { $match: baseMatch },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      this.invoiceModel.aggregate<{ outstanding: number }>([
        {
          $match: {
            ...baseMatch,
            status: { $in: OUTSTANDING_INVOICE_STATUSES },
          },
        },
        {
          $group: {
            _id: null,
            outstanding: { $sum: { $subtract: ['$total', '$amountPaid'] } },
          },
        },
      ]),
    ]);

    const currency = organization?.currency ?? null;
    const [leads, leadsTotal] = toStatusMap(leadsByStatus);
    const [orders, ordersTotal] = toStatusMap(ordersByStatus);
    const [invoices, invoicesTotal] = toStatusMap(invoicesByStatus);

    return {
      leads: { total: leadsTotal, byStatus: leads },
      bookings: { total: bookingsTotal, upcoming: bookingsUpcoming },
      orders: {
        total: ordersTotal,
        byStatus: orders,
        revenue: revenueRows[0]?.revenue ?? 0,
        currency,
      },
      invoices: {
        total: invoicesTotal,
        byStatus: invoices,
        outstanding: outstandingRows[0]?.outstanding ?? 0,
        currency,
      },
    };
  }

  async getRevenueTimeseries(
    organizationId: string,
    query: AnalyticsRevenueQuery,
  ): Promise<AnalyticsRevenueTimeseries> {
    const organizationObjectId = new Types.ObjectId(organizationId);
    const organization = await this.organizationModel
      .findById(organizationObjectId)
      .lean();

    const createdAt = dateRangeMatch(query.from, query.to) ?? {
      $gte: defaultRangeStart(query.interval),
    };
    const dateFormat = { day: '%Y-%m-%d', week: '%G-W%V', month: '%Y-%m' }[
      query.interval
    ];

    const rows = await this.orderModel.aggregate<{
      _id: string;
      revenue: number;
    }>([
      {
        $match: {
          organizationId: organizationObjectId,
          status: { $in: REVENUE_ORDER_STATUSES },
          createdAt,
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: dateFormat, date: '$createdAt' } },
          revenue: { $sum: '$total' },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const points: AnalyticsRevenuePoint[] = rows.map((row) => ({
      date: row._id,
      revenue: row.revenue,
    }));
    return { points, currency: organization?.currency ?? null };
  }

  async getActivity(
    organizationId: string,
    limit: number,
  ): Promise<AnalyticsActivityEntry[]> {
    const entries = await this.auditService.listRecent(organizationId, limit);
    return entries.map((entry) => {
      const json = entry.toJSON() as unknown as {
        id: string;
        action: string;
        entity: string;
        entityId?: string;
        createdAt: Date | string;
      };
      return {
        id: json.id,
        action: json.action,
        entity: json.entity,
        entityId: json.entityId,
        createdAt: new Date(json.createdAt).toISOString(),
      };
    });
  }
}

function dateRangeMatch(
  from?: string,
  to?: string,
): Record<string, Date> | undefined {
  if (!from && !to) return undefined;
  const range: Record<string, Date> = {};
  if (from) range.$gte = new Date(from);
  if (to) range.$lte = new Date(to);
  return range;
}

function defaultRangeStart(interval: 'day' | 'week' | 'month'): Date {
  const days = { day: 30, week: 90, month: 365 }[interval];
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function toStatusMap<S extends string>(
  rows: StatusCount<S>[],
): [Partial<Record<S, number>>, number] {
  const map: Partial<Record<S, number>> = {};
  let total = 0;
  for (const row of rows) {
    map[row._id] = row.count;
    total += row.count;
  }
  return [map, total];
}
