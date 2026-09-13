import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BusinessGraphService } from './business-graph.service';

function makeFindModel(results: unknown[] = []) {
  return {
    find: jest
      .fn()
      .mockReturnValue({ lean: jest.fn().mockResolvedValue(results) }),
    countDocuments: jest.fn().mockResolvedValue(results.length),
  };
}

function makeFindOneModel(result: unknown) {
  return {
    findOne: jest
      .fn()
      .mockReturnValue({ lean: jest.fn().mockResolvedValue(result) }),
  };
}

describe('BusinessGraphService', () => {
  const ORG_ID = '507f1f77bcf86cd799439011';
  const CONTACT_ID = '507f1f77bcf86cd799439022';

  function buildService(
    overrides: {
      contact?: unknown;
      leads?: unknown[];
      deals?: unknown[];
      quotes?: unknown[];
      invoices?: unknown[];
      payments?: unknown[];
      bookings?: unknown[];
      orders?: unknown[];
      conversations?: unknown[];
      tasks?: unknown[];
      suppliers?: unknown[];
      purchaseOrders?: unknown[];
    } = {},
  ) {
    const contactModel = makeFindOneModel(
      'contact' in overrides
        ? overrides.contact
        : { _id: new Types.ObjectId(CONTACT_ID) },
    );
    const leadModel = makeFindModel(overrides.leads ?? []);
    const dealModel = makeFindModel(overrides.deals ?? []);
    const taskModel = makeFindModel(overrides.tasks ?? []);
    const quoteModel = makeFindModel(overrides.quotes ?? []);
    const invoiceModel = makeFindModel(overrides.invoices ?? []);
    const paymentModel = makeFindModel(overrides.payments ?? []);
    const bookingModel = makeFindModel(overrides.bookings ?? []);
    const orderModel = makeFindModel(overrides.orders ?? []);
    const conversationModel = makeFindModel(overrides.conversations ?? []);
    const supplierModel = makeFindModel(overrides.suppliers ?? []);
    const purchaseOrderModel = makeFindModel(overrides.purchaseOrders ?? []);
    const analyticsService = {
      getDeadStock: jest.fn().mockResolvedValue([]),
      getReorderSuggestions: jest.fn().mockResolvedValue([]),
    };

    const service = new BusinessGraphService(
      contactModel as never,
      leadModel as never,
      dealModel as never,
      taskModel as never,
      quoteModel as never,
      invoiceModel as never,
      paymentModel as never,
      bookingModel as never,
      orderModel as never,
      conversationModel as never,
      supplierModel as never,
      purchaseOrderModel as never,
      analyticsService as never,
    );

    return {
      service,
      contactModel,
      leadModel,
      dealModel,
      taskModel,
      quoteModel,
      invoiceModel,
      paymentModel,
      bookingModel,
      orderModel,
      conversationModel,
      supplierModel,
      purchaseOrderModel,
      analyticsService,
    };
  }

  it('throws CONTACT_NOT_FOUND when the contact does not exist in this organization', async () => {
    const { service } = buildService({ contact: null });

    await expect(
      service.getContactTimeline(ORG_ID, CONTACT_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it('scopes every cross-module query to the requesting organization and contact', async () => {
    const {
      service,
      leadModel,
      quoteModel,
      invoiceModel,
      bookingModel,
      orderModel,
      conversationModel,
    } = buildService();

    await service.getContactTimeline(ORG_ID, CONTACT_ID);

    for (const model of [
      leadModel,
      quoteModel,
      invoiceModel,
      bookingModel,
      orderModel,
      conversationModel,
    ]) {
      const call = model.find.mock.calls[0] as unknown[];
      const filter = call[0] as {
        organizationId?: Types.ObjectId;
        contactId?: Types.ObjectId;
      };
      expect(filter.organizationId?.toString()).toBe(ORG_ID);
      expect(filter.contactId?.toString()).toBe(CONTACT_ID);
    }
  });

  it('does not query Payments at all when the contact has no invoices', async () => {
    const { service, paymentModel } = buildService({ invoices: [] });

    await service.getContactTimeline(ORG_ID, CONTACT_ID);

    expect(paymentModel.find).not.toHaveBeenCalled();
  });

  it("fetches Payments scoped to exactly this contact's invoice ids", async () => {
    const invoiceId = new Types.ObjectId();
    const { service, paymentModel } = buildService({
      invoices: [
        {
          _id: invoiceId,
          number: 'FAC-0001',
          status: 'issued',
          total: 100,
          currency: 'EUR',
        },
      ],
    });

    await service.getContactTimeline(ORG_ID, CONTACT_ID);

    const paymentCall = paymentModel.find.mock.calls[0] as unknown[];
    const filter = paymentCall[0] as {
      organizationId?: Types.ObjectId;
      invoiceId?: { $in: Types.ObjectId[] };
    };
    expect(filter.organizationId?.toString()).toBe(ORG_ID);
    expect(filter.invoiceId?.$in).toEqual([invoiceId]);
  });

  it('includes tasks linked directly to the contact and tasks linked to any of its leads', async () => {
    const leadId = new Types.ObjectId();
    const { service, taskModel } = buildService({
      leads: [{ _id: leadId, status: 'open' }],
    });

    await service.getContactTimeline(ORG_ID, CONTACT_ID);

    const taskCall = taskModel.find.mock.calls[0] as unknown[];
    const filter = taskCall[0] as {
      $or: Array<{ entity: string; entityId: unknown }>;
    };
    expect(filter.$or).toEqual([
      { entity: 'contact', entityId: new Types.ObjectId(CONTACT_ID) },
      { entity: 'lead', entityId: { $in: [leadId] } },
    ]);
  });

  it('assembles entries from every module and sorts them most-recent-first', async () => {
    const { service } = buildService({
      leads: [
        {
          _id: new Types.ObjectId(),
          status: 'open',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ],
      quotes: [
        {
          _id: new Types.ObjectId(),
          number: 'DEV-0001',
          status: 'sent',
          total: 240,
          currency: 'EUR',
          createdAt: new Date('2026-03-01T00:00:00Z'),
        },
      ],
      bookings: [
        {
          _id: new Types.ObjectId(),
          status: 'confirmed',
          startAt: new Date('2026-02-01T00:00:00Z'),
          pricing: { amount: 50, currency: 'EUR' },
        },
      ],
    });

    const timeline = await service.getContactTimeline(ORG_ID, CONTACT_ID);

    expect(timeline.contactId).toBe(CONTACT_ID);
    expect(timeline.entries.map((e) => e.type)).toEqual([
      'quote',
      'booking',
      'lead',
    ]);
    expect(timeline.entries[0]?.summary).toBe('Devis DEV-0001 (sent)');
    expect(timeline.entries[0]?.amount).toBe(240);
  });

  it('includes deal entries (Phase F1 — Deal was split out of Lead in D1) with their estimatedValue as amount', async () => {
    const { service } = buildService({
      deals: [
        {
          _id: new Types.ObjectId(),
          status: 'open',
          estimatedValue: 500,
          createdAt: new Date('2026-04-01T00:00:00Z'),
        },
      ],
    });

    const timeline = await service.getContactTimeline(ORG_ID, CONTACT_ID);

    expect(timeline.entries).toHaveLength(1);
    expect(timeline.entries[0]).toMatchObject({
      type: 'deal',
      status: 'open',
      summary: 'Affaire (open)',
      amount: 500,
    });
  });

  it("includes tasks linked to any of the contact's deals, alongside contact/lead tasks", async () => {
    const dealId = new Types.ObjectId();
    const { service, taskModel } = buildService({
      deals: [{ _id: dealId, status: 'open' }],
    });

    await service.getContactTimeline(ORG_ID, CONTACT_ID);

    const taskCall = taskModel.find.mock.calls[0] as unknown[];
    const filter = taskCall[0] as {
      $or: Array<{ entity: string; entityId: unknown }>;
    };
    expect(filter.$or).toEqual([
      { entity: 'contact', entityId: new Types.ObjectId(CONTACT_ID) },
      { entity: 'deal', entityId: { $in: [dealId] } },
    ]);
  });
});

describe('BusinessGraphService.getOrganizationSummary (Phase F1)', () => {
  const ORG_ID = '507f1f77bcf86cd799439011';

  function buildService(overrides: {
    openLeadsCount?: number;
    openDeals?: { estimatedValue?: number }[];
    overdueInvoices?: { total: number; amountPaid: number }[];
    deadStock?: unknown[];
    reorderSuggestions?: unknown[];
    supplierCount?: number;
    pendingPurchaseOrdersCount?: number;
  }) {
    const leadModel = {
      countDocuments: jest
        .fn()
        .mockResolvedValue(overrides.openLeadsCount ?? 0),
    };
    const dealModel = makeFindModel(overrides.openDeals ?? []);
    const invoiceModel = makeFindModel(overrides.overdueInvoices ?? []);
    const supplierModel = {
      countDocuments: jest.fn().mockResolvedValue(overrides.supplierCount ?? 0),
    };
    const purchaseOrderModel = {
      countDocuments: jest
        .fn()
        .mockResolvedValue(overrides.pendingPurchaseOrdersCount ?? 0),
    };
    const analyticsService = {
      getDeadStock: jest.fn().mockResolvedValue(overrides.deadStock ?? []),
      getReorderSuggestions: jest
        .fn()
        .mockResolvedValue(overrides.reorderSuggestions ?? []),
    };

    const service = new BusinessGraphService(
      {} as never,
      leadModel as never,
      dealModel as never,
      {} as never,
      {} as never,
      invoiceModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      supplierModel as never,
      purchaseOrderModel as never,
      analyticsService as never,
    );

    return {
      service,
      leadModel,
      invoiceModel,
      supplierModel,
      purchaseOrderModel,
    };
  }

  it('sums openDealsValue off open deals only, defaulting a missing estimatedValue to 0', async () => {
    const { service } = buildService({
      openDeals: [
        { estimatedValue: 100 },
        { estimatedValue: undefined },
        { estimatedValue: 50 },
      ],
    });

    const summary = await service.getOrganizationSummary(ORG_ID);

    expect(summary.crm.openDealsCount).toBe(3);
    expect(summary.crm.openDealsValue).toBe(150);
  });

  it('computes overdueInvoicesTotal as total minus amountPaid, never negative', async () => {
    const { service } = buildService({
      overdueInvoices: [
        { total: 100, amountPaid: 20 },
        { total: 50, amountPaid: 60 }, // over-paid edge case — must clamp at 0, not go negative
      ],
    });

    const summary = await service.getOrganizationSummary(ORG_ID);

    expect(summary.finance.overdueInvoicesCount).toBe(2);
    expect(summary.finance.overdueInvoicesTotal).toBe(80);
  });

  it('passes the inventory fields through from AnalyticsService verbatim, never re-deriving them', async () => {
    const { service } = buildService({
      deadStock: [{ offerId: '1' }, { offerId: '2' }],
      reorderSuggestions: [{ offerId: '3' }],
    });

    const summary = await service.getOrganizationSummary(ORG_ID);

    expect(summary.inventory.deadStockCount).toBe(2);
    expect(summary.inventory.lowStockCount).toBe(1);
  });

  it('scopes the lead/deal/invoice/supplier/purchase-order queries to the requesting organization', async () => {
    const {
      service,
      leadModel,
      invoiceModel,
      supplierModel,
      purchaseOrderModel,
    } = buildService({});

    await service.getOrganizationSummary(ORG_ID);

    const leadCall = leadModel.countDocuments.mock.calls[0] as unknown[];
    const leadFilter = leadCall[0] as { organizationId: Types.ObjectId };
    expect(leadFilter.organizationId.toString()).toBe(ORG_ID);
    const invoiceCall = invoiceModel.find.mock.calls[0] as unknown[];
    const invoiceFilter = invoiceCall[0] as {
      organizationId: Types.ObjectId;
      status: string;
    };
    expect(invoiceFilter.organizationId.toString()).toBe(ORG_ID);
    expect(invoiceFilter.status).toBe('overdue');
    const supplierCall = supplierModel.countDocuments.mock
      .calls[0] as unknown[];
    const supplierFilter = supplierCall[0] as {
      organizationId: Types.ObjectId;
    };
    expect(supplierFilter.organizationId.toString()).toBe(ORG_ID);
    const poCall = purchaseOrderModel.countDocuments.mock.calls[0] as unknown[];
    const poFilter = poCall[0] as {
      organizationId: Types.ObjectId;
      status: string;
    };
    expect(poFilter.organizationId.toString()).toBe(ORG_ID);
    expect(poFilter.status).toBe('ordered');
  });
});
