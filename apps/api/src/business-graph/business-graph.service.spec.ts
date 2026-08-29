import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { BusinessGraphService } from './business-graph.service';

function makeFindModel(results: unknown[] = []) {
  return {
    find: jest
      .fn()
      .mockReturnValue({ lean: jest.fn().mockResolvedValue(results) }),
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
      quotes?: unknown[];
      invoices?: unknown[];
      payments?: unknown[];
      bookings?: unknown[];
      orders?: unknown[];
      conversations?: unknown[];
      tasks?: unknown[];
    } = {},
  ) {
    const contactModel = makeFindOneModel(
      'contact' in overrides
        ? overrides.contact
        : { _id: new Types.ObjectId(CONTACT_ID) },
    );
    const leadModel = makeFindModel(overrides.leads ?? []);
    const taskModel = makeFindModel(overrides.tasks ?? []);
    const quoteModel = makeFindModel(overrides.quotes ?? []);
    const invoiceModel = makeFindModel(overrides.invoices ?? []);
    const paymentModel = makeFindModel(overrides.payments ?? []);
    const bookingModel = makeFindModel(overrides.bookings ?? []);
    const orderModel = makeFindModel(overrides.orders ?? []);
    const conversationModel = makeFindModel(overrides.conversations ?? []);

    const service = new BusinessGraphService(
      contactModel as never,
      leadModel as never,
      taskModel as never,
      quoteModel as never,
      invoiceModel as never,
      paymentModel as never,
      bookingModel as never,
      orderModel as never,
      conversationModel as never,
    );

    return {
      service,
      contactModel,
      leadModel,
      taskModel,
      quoteModel,
      invoiceModel,
      paymentModel,
      bookingModel,
      orderModel,
      conversationModel,
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
});
