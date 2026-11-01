import { Types } from 'mongoose';
import { AnalyticsService } from './analytics.service';
import type { AuditService } from '../audit/audit.service';

function makeAggregateModel(result: unknown[] = []) {
  return {
    aggregate: jest.fn().mockResolvedValue(result),
    countDocuments: jest.fn().mockResolvedValue(0),
  };
}

function makeOrgModel(currency: string | null = 'EUR') {
  return {
    findById: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(currency ? { currency } : null),
    }),
  };
}

describe('AnalyticsService — tenant isolation', () => {
  const ORG_ID = '507f1f77bcf86cd799439011';

  function buildService(
    overrides: {
      leadModel?: ReturnType<typeof makeAggregateModel>;
      bookingModel?: ReturnType<typeof makeAggregateModel>;
      orderModel?: ReturnType<typeof makeAggregateModel>;
      invoiceModel?: ReturnType<typeof makeAggregateModel>;
      organizationModel?: ReturnType<typeof makeOrgModel>;
      offerModel?: ReturnType<typeof makeAggregateModel>;
      stockMovementModel?: ReturnType<typeof makeAggregateModel>;
    } = {},
  ) {
    const leadModel = overrides.leadModel ?? makeAggregateModel([]);
    const bookingModel = overrides.bookingModel ?? makeAggregateModel([]);
    const orderModel = overrides.orderModel ?? makeAggregateModel([]);
    const invoiceModel = overrides.invoiceModel ?? makeAggregateModel([]);
    const organizationModel = overrides.organizationModel ?? makeOrgModel();
    const offerModel = overrides.offerModel ?? makeAggregateModel([]);
    const stockMovementModel =
      overrides.stockMovementModel ?? makeAggregateModel([]);
    const listRecent = jest.fn().mockResolvedValue([]);
    const auditService = { listRecent } as unknown as AuditService;

    const service = new AnalyticsService(
      leadModel as never,
      bookingModel as never,
      orderModel as never,
      invoiceModel as never,
      organizationModel as never,
      offerModel as never,
      stockMovementModel as never,
      makeAggregateModel([]) as never,
      auditService,
    );

    return {
      service,
      leadModel,
      bookingModel,
      orderModel,
      invoiceModel,
      organizationModel,
      offerModel,
      stockMovementModel,
      auditService,
      listRecent,
    };
  }

  it('scopes every leads/orders/invoices aggregation to the requesting organization only', async () => {
    const { service, leadModel, orderModel, invoiceModel, bookingModel } =
      buildService();

    await service.getOverview(ORG_ID);

    for (const model of [leadModel, orderModel, invoiceModel]) {
      // Two aggregate() calls per model in getOverview (status breakdown + a
      // revenue/outstanding sum) — every single pipeline must filter by this org.
      expect(model.aggregate).toHaveBeenCalled();
      for (const call of model.aggregate.mock.calls as unknown[][]) {
        const pipeline = call[0] as Array<{
          $match?: { organizationId?: unknown };
        }>;
        const match = pipeline[0]?.$match;
        expect(match?.organizationId).toBeInstanceOf(Types.ObjectId);
        expect((match?.organizationId as Types.ObjectId).toString()).toBe(
          ORG_ID,
        );
      }
    }

    for (const call of bookingModel.countDocuments.mock.calls as unknown[][]) {
      const filter = call[0] as { organizationId?: unknown };
      expect((filter.organizationId as Types.ObjectId).toString()).toBe(ORG_ID);
    }
  });

  it('never lets one organization query leak into another: different orgs produce independently-scoped queries', async () => {
    const OTHER_ORG_ID = '507f1f77bcf86cd799439099';
    const { service, orderModel } = buildService();

    await service.getOverview(ORG_ID);
    await service.getRevenueTimeseries(OTHER_ORG_ID, { interval: 'day' });

    const scopedOrgIds = (orderModel.aggregate.mock.calls as unknown[][]).map(
      (call) => {
        const pipeline = call[0] as Array<{
          $match?: { organizationId?: unknown };
        }>;
        return (
          pipeline[0]?.$match?.organizationId as Types.ObjectId
        ).toString();
      },
    );

    expect(scopedOrgIds).toContain(ORG_ID);
    expect(scopedOrgIds).toContain(OTHER_ORG_ID);
    expect(new Set(scopedOrgIds).size).toBeGreaterThan(1);
  });

  it('sums per-status counts and revenue correctly from grouped aggregation rows', async () => {
    const { service } = buildService({
      leadModel: makeAggregateModel([
        { _id: 'open', count: 3 },
        { _id: 'won', count: 2 },
      ]),
      orderModel: (() => {
        const model = makeAggregateModel([]);
        model.aggregate
          .mockResolvedValueOnce([
            { _id: 'confirmed', count: 4 },
            { _id: 'pending', count: 1 },
          ])
          .mockResolvedValueOnce([{ revenue: 1500 }]);
        return model;
      })(),
      invoiceModel: (() => {
        const model = makeAggregateModel([]);
        model.aggregate
          .mockResolvedValueOnce([{ _id: 'issued', count: 2 }])
          .mockResolvedValueOnce([{ outstanding: 400 }]);
        return model;
      })(),
    });

    const overview = await service.getOverview(ORG_ID);

    expect(overview.leads).toEqual({ total: 5, byStatus: { open: 3, won: 2 } });
    expect(overview.orders.total).toBe(5);
    expect(overview.orders.byStatus).toEqual({ confirmed: 4, pending: 1 });
    expect(overview.orders.revenue).toBe(1500);
    expect(overview.orders.currency).toBe('EUR');
    expect(overview.invoices.outstanding).toBe(400);
  });

  it('returns zeroed-out, non-fabricated results for a brand-new organization with no data', async () => {
    const { service } = buildService();

    const overview = await service.getOverview(ORG_ID);

    expect(overview.leads).toEqual({ total: 0, byStatus: {} });
    expect(overview.orders).toEqual({
      total: 0,
      byStatus: {},
      revenue: 0,
      currency: 'EUR',
    });
    expect(overview.invoices.outstanding).toBe(0);
  });

  it('getActivity delegates to AuditService.listRecent scoped to the organization and maps entries', async () => {
    const { service, listRecent } = buildService();
    listRecent.mockResolvedValue([
      {
        toJSON: () => ({
          id: 'log-1',
          action: 'CREATE',
          entity: 'lead',
          entityId: 'lead-1',
          createdAt: new Date('2026-08-20T10:00:00.000Z'),
        }),
      },
    ]);

    const activity = await service.getActivity(ORG_ID, 10);

    expect(listRecent).toHaveBeenCalledWith(ORG_ID, 10);
    expect(activity).toEqual([
      {
        id: 'log-1',
        action: 'CREATE',
        entity: 'lead',
        entityId: 'lead-1',
        createdAt: '2026-08-20T10:00:00.000Z',
      },
    ]);
  });
});
