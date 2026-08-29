import { Types } from 'mongoose';
import { DecisionEngineService } from './decision-engine.service';
import { InvoiceOverdueFollowupRule } from './rules/invoice-overdue-followup.rule';
import { CustomerReactivationRule } from './rules/customer-reactivation.rule';
import type { RecommendationsRepository } from './recommendations.repository';
import type { AuditService } from '../audit/audit.service';

const ORG_ID = '507f1f77bcf86cd799439011';

function buildService(overrides: { createIfNotExists?: jest.Mock } = {}) {
  const createIfNotExists =
    overrides.createIfNotExists ??
    jest.fn().mockResolvedValue({
      id: new Types.ObjectId().toString(),
    });
  const recommendationsRepository = {
    createIfNotExists,
  } as unknown as RecommendationsRepository;
  const record = jest.fn().mockResolvedValue(undefined);
  const auditService = { record } as unknown as AuditService;

  const service = new DecisionEngineService(
    new InvoiceOverdueFollowupRule(),
    new CustomerReactivationRule(),
    recommendationsRepository,
    auditService,
  );

  return { service, createIfNotExists, record };
}

describe('DecisionEngineService', () => {
  it('does nothing for an event no rule declares', async () => {
    const { service, createIfNotExists } = buildService();

    await service.handleEvent(ORG_ID, 'lead.created', { leadId: 'x' });

    expect(createIfNotExists).not.toHaveBeenCalled();
  });

  it('creates a Recommendation from the matching rule and audits it', async () => {
    const { service, createIfNotExists, record } = buildService();

    await service.handleEvent(ORG_ID, 'invoice.overdue', {
      invoiceId: '507f1f77bcf86cd799439022',
      contactId: '507f1f77bcf86cd799439033',
      total: 300,
      amountPaid: 100,
    });

    expect(createIfNotExists).toHaveBeenCalledTimes(1);
    const call = createIfNotExists.mock.calls[0] as unknown[];
    const draft = call[0] as {
      ruleKey: string;
      entityType: string;
      entityId: Types.ObjectId;
    };
    expect(draft.ruleKey).toBe('invoice_overdue_followup');
    expect(draft.entityType).toBe('invoice');
    expect(draft.entityId.toString()).toBe('507f1f77bcf86cd799439022');
    expect(record).toHaveBeenCalledTimes(1);
  });

  it('treats an already-existing recommendation (createIfNotExists returning null) as a normal skip, not an error, and does not audit it', async () => {
    const { service, record } = buildService({
      createIfNotExists: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.handleEvent(ORG_ID, 'customer.inactive', {
        contactId: '507f1f77bcf86cd799439033',
        inactiveDays: 61,
      }),
    ).resolves.toBeUndefined();
    expect(record).not.toHaveBeenCalled();
  });

  it('isolates a rule that throws — the event is not re-thrown, so the job is never marked failed over a rule-level bug', async () => {
    const { service, createIfNotExists } = buildService({
      createIfNotExists: jest.fn().mockRejectedValue(new Error('db down')),
    });

    await expect(
      service.handleEvent(ORG_ID, 'invoice.overdue', {
        invoiceId: '507f1f77bcf86cd799439022',
        total: 100,
        amountPaid: 0,
      }),
    ).resolves.toBeUndefined();
    expect(createIfNotExists).toHaveBeenCalledTimes(1);
  });

  it('builds a human-readable description for the customer reactivation rule, including the inactive-days count', async () => {
    const { service, createIfNotExists } = buildService();

    await service.handleEvent(ORG_ID, 'customer.inactive', {
      contactId: '507f1f77bcf86cd799439033',
      inactiveDays: 61,
    });

    const call = createIfNotExists.mock.calls[0] as unknown[];
    const draft = call[0] as {
      title: string;
      description: string;
    };
    expect(draft.title).toBe('Client inactif à relancer');
    expect(draft.description).toContain('61 jours');
  });
});
