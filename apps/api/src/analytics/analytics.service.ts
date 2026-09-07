import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type {
  AnalyticsActivityEntry,
  AnalyticsOverview,
  AnalyticsRevenuePoint,
  AnalyticsRevenueTimeseries,
  InventoryDeadStockEntry,
  InventoryTurnoverEntry,
  InventoryValuation,
  InventoryValuationEntry,
  InvoiceStatus,
  LeadStatus,
  OrderStatus,
  ReorderSuggestionEntry,
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
import { Offer, OfferDocument } from '../catalog/offers/schemas/offer.schema';
import {
  StockMovement,
  StockMovementDocument,
} from '../catalog/offers/schemas/stock-movement.schema';
import { AuditService } from '../audit/audit.service';

/** An offer with no variants keeps its stock on its own `stockOnHand`; one with variants keeps
 *  it entirely per-variant instead (see Offer.stockOnHand's own doc in @korva/types) — every
 *  Phase C3 metric needs "this offer's total stock right now" regardless of which shape it uses. */
function totalStock(offer: {
  stockOnHand?: number;
  variants: { stockOnHand?: number }[];
}): number {
  if (offer.variants.length > 0) {
    return offer.variants.reduce((sum, v) => sum + (v.stockOnHand ?? 0), 0);
  }
  return offer.stockOnHand ?? 0;
}

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
    @InjectModel(Offer.name) private readonly offerModel: Model<OfferDocument>,
    @InjectModel(StockMovement.name)
    private readonly stockMovementModel: Model<StockMovementDocument>,
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

  /** Phase C3 (docs/KORVA_OS_V2_AUDIT.md §2.4) — off the existing StockMovement ledger, no new
   *  instrumentation. `turnoverRatio` is a simplified "units sold ÷ current stock" proxy, not a
   *  formal weighted-average-inventory calculation (see InventoryTurnoverEntry's own doc). */
  async getInventoryTurnover(
    organizationId: string,
    days: number,
  ): Promise<InventoryTurnoverEntry[]> {
    const organizationObjectId = new Types.ObjectId(organizationId);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [offers, soldRows] = await Promise.all([
      this.offerModel
        .find({ organizationId: organizationObjectId, trackStock: true })
        .lean()
        .exec(),
      this.stockMovementModel.aggregate<{
        _id: Types.ObjectId;
        unitsSold: number;
      }>([
        {
          $match: {
            organizationId: organizationObjectId,
            type: 'sold',
            createdAt: { $gte: since },
          },
        },
        {
          $group: {
            _id: '$offerId',
            unitsSold: { $sum: { $abs: '$quantity' } },
          },
        },
      ]),
    ]);
    const soldByOffer = new Map(
      soldRows.map((row) => [row._id.toString(), row.unitsSold]),
    );

    return offers.map((offer) => {
      const currentStock = totalStock(offer);
      const unitsSoldInPeriod = soldByOffer.get(offer._id.toString()) ?? 0;
      return {
        offerId: offer._id.toString(),
        offerName: offer.name,
        currentStock,
        unitsSoldInPeriod,
        turnoverRatio:
          currentStock > 0 ? unitsSoldInPeriod / currentStock : null,
      };
    });
  }

  /** A tracked offer that still has stock but hasn't recorded a single `sold` movement within
   *  the lookback window (or ever) — a real, ledger-grounded definition, not a heuristic guess. */
  async getDeadStock(
    organizationId: string,
    days: number,
  ): Promise<InventoryDeadStockEntry[]> {
    const organizationObjectId = new Types.ObjectId(organizationId);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const offers = await this.offerModel
      .find({ organizationId: organizationObjectId, trackStock: true })
      .lean()
      .exec();
    const withStock = offers.filter((offer) => totalStock(offer) > 0);
    if (withStock.length === 0) return [];

    const lastSoldRows = await this.stockMovementModel.aggregate<{
      _id: Types.ObjectId;
      lastSoldAt: Date;
    }>([
      {
        $match: {
          organizationId: organizationObjectId,
          type: 'sold',
          offerId: { $in: withStock.map((offer) => offer._id) },
        },
      },
      { $group: { _id: '$offerId', lastSoldAt: { $max: '$createdAt' } } },
    ]);
    const lastSoldByOffer = new Map(
      lastSoldRows.map((row) => [row._id.toString(), row.lastSoldAt]),
    );

    return withStock
      .filter((offer) => {
        const lastSoldAt = lastSoldByOffer.get(offer._id.toString());
        return !lastSoldAt || lastSoldAt < since;
      })
      .map((offer) => ({
        offerId: offer._id.toString(),
        offerName: offer.name,
        currentStock: totalStock(offer),
        lastSoldAt:
          lastSoldByOffer.get(offer._id.toString())?.toISOString() ?? null,
      }));
  }

  /** Reads each offer's MOST RECENT costed `received` movement (see StockMovement.unitCost's own
   *  doc) — an offer with stock but no costed movement yet is excluded from `totalValue` and
   *  counted in `unvaluedOfferCount` instead of being guessed at. Offer-level only: a variant-
   *  tracked offer uses its most recent cost regardless of which variant it was received for —
   *  an accepted v1 simplification, not a per-variant valuation. */
  async getInventoryValuation(
    organizationId: string,
  ): Promise<InventoryValuation> {
    const organizationObjectId = new Types.ObjectId(organizationId);
    const [offers, organization, costRows] = await Promise.all([
      this.offerModel
        .find({ organizationId: organizationObjectId, trackStock: true })
        .lean()
        .exec(),
      this.organizationModel.findById(organizationId).exec(),
      this.stockMovementModel.aggregate<{
        _id: Types.ObjectId;
        unitCost: number;
      }>([
        {
          $match: {
            organizationId: organizationObjectId,
            type: 'received',
            unitCost: { $exists: true, $ne: null },
          },
        },
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$offerId', unitCost: { $first: '$unitCost' } } },
      ]),
    ]);
    const costByOffer = new Map(
      costRows.map((row) => [row._id.toString(), row.unitCost]),
    );

    const entries: InventoryValuationEntry[] = [];
    let unvaluedOfferCount = 0;
    for (const offer of offers) {
      const currentStock = totalStock(offer);
      if (currentStock === 0) continue;
      const unitCost = costByOffer.get(offer._id.toString());
      if (unitCost === undefined) {
        unvaluedOfferCount++;
        continue;
      }
      entries.push({
        offerId: offer._id.toString(),
        offerName: offer.name,
        currentStock,
        unitCost,
        totalValue: currentStock * unitCost,
      });
    }

    return {
      entries,
      totalValue: entries.reduce((sum, entry) => sum + entry.totalValue, 0),
      currency: organization?.currency ?? null,
      unvaluedOfferCount,
    };
  }

  /** Phase C4 (docs/KORVA_OS_V2_AUDIT.md §2.4) — offers at or below their own `lowStockThreshold`
   *  (the same reorder-point field LowStockThresholdAlertRule already reacts to). Only offers
   *  that opted into a real threshold are considered — an offer with no threshold set has no
   *  reorder point to compare against, same reasoning as the existing Decision Engine rule. */
  async getReorderSuggestions(
    organizationId: string,
  ): Promise<ReorderSuggestionEntry[]> {
    const organizationObjectId = new Types.ObjectId(organizationId);
    const offers = await this.offerModel
      .find({
        organizationId: organizationObjectId,
        trackStock: true,
        lowStockThreshold: { $exists: true, $ne: null },
      })
      .lean()
      .exec();
    const belowThreshold = offers.filter(
      (offer) => totalStock(offer) <= (offer.lowStockThreshold ?? 0),
    );
    if (belowThreshold.length === 0) return [];

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const soldRows = await this.stockMovementModel.aggregate<{
      _id: Types.ObjectId;
      unitsSold: number;
    }>([
      {
        $match: {
          organizationId: organizationObjectId,
          type: 'sold',
          createdAt: { $gte: since },
          offerId: { $in: belowThreshold.map((offer) => offer._id) },
        },
      },
      {
        $group: { _id: '$offerId', unitsSold: { $sum: { $abs: '$quantity' } } },
      },
    ]);
    const soldByOffer = new Map(
      soldRows.map((row) => [row._id.toString(), row.unitsSold]),
    );

    return belowThreshold.map((offer) => {
      const currentStock = totalStock(offer);
      const lowStockThreshold = offer.lowStockThreshold ?? 0;
      const unitsSoldInLast30Days = soldByOffer.get(offer._id.toString()) ?? 0;
      return {
        offerId: offer._id.toString(),
        offerName: offer.name,
        currentStock,
        lowStockThreshold,
        unitsSoldInLast30Days,
        suggestedReorderQuantity: Math.max(
          unitsSoldInLast30Days,
          lowStockThreshold - currentStock,
          1,
        ),
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
