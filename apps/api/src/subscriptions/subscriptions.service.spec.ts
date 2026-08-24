import { Model } from 'mongoose';
import { SubscriptionsService } from './subscriptions.service';
import type { SubscriptionsRepository } from './subscriptions.repository';
import type { PlansService } from './plans.service';
import type { AuditService } from '../audit/audit.service';
import type { OrganizationDocument } from '../organizations/schemas/organization.schema';

describe('SubscriptionsService.changePlan — enabledModules synchronization', () => {
  const ORG_ID = 'org-1';
  const USER_ID = 'user-1';

  const FREE_PLAN = {
    _id: 'plan-free',
    key: 'free',
    modules: [
      'crm',
      'catalog',
      'booking',
      'commerce',
      'finance',
      'workflow',
      'communication',
      'analytics',
      'ai',
    ],
  };
  const STARTER_PLAN = {
    _id: 'plan-starter',
    key: 'starter',
    modules: [
      'crm',
      'catalog',
      'booking',
      'commerce',
      'finance',
      'communication',
      'analytics',
    ],
  };
  const PRO_PLAN = { ...FREE_PLAN, _id: 'plan-pro', key: 'pro' };

  function buildService(options: {
    plan: typeof FREE_PLAN;
    organization: { enabledModules: string[]; save: jest.Mock } | null;
  }) {
    const getByKey = jest.fn().mockResolvedValue(options.plan);
    const plansService = { getByKey } as unknown as PlansService;

    const update = jest.fn().mockResolvedValue({ id: 'sub-1' });
    const subscriptionsRepository = {
      update,
    } as unknown as SubscriptionsRepository;

    const record = jest.fn().mockResolvedValue(undefined);
    const auditService = { record } as unknown as AuditService;

    const exec = jest.fn().mockResolvedValue(options.organization);
    const findById = jest.fn().mockReturnValue({ exec });
    const organizationModel = {
      findById,
    } as unknown as Model<OrganizationDocument>;

    const service = new SubscriptionsService(
      subscriptionsRepository,
      plansService,
      auditService,
      organizationModel,
    );

    return { service, update };
  }

  function makeOrg(enabledModules: string[]) {
    return { enabledModules, save: jest.fn().mockResolvedValue(undefined) };
  }

  it('G1 — free -> starter with workflow/ai enabled: both are dropped, everything else kept', async () => {
    const organization = makeOrg(['crm', 'workflow', 'ai']);
    const { service } = buildService({ plan: STARTER_PLAN, organization });

    await service.changePlan(ORG_ID, USER_ID, 'starter');

    expect(organization.enabledModules).toEqual(['crm']);
    expect(organization.save).toHaveBeenCalledTimes(1);
  });

  it('G2 — starter -> pro: no module the organization had not already chosen is auto-added', async () => {
    const organization = makeOrg(['crm', 'catalog']);
    const { service } = buildService({ plan: PRO_PLAN, organization });

    await service.changePlan(ORG_ID, USER_ID, 'pro');

    // pro allows workflow/ai too, but the organization never enabled them — must stay off.
    // Nothing was actually dropped, so no write is needed either (idempotent no-op).
    expect(organization.enabledModules).toEqual(['crm', 'catalog']);
    expect(organization.save).not.toHaveBeenCalled();
  });

  it('G3 — plan unchanged: no write when every enabled module is still allowed', async () => {
    const organization = makeOrg(['crm', 'catalog']);
    const { service } = buildService({ plan: FREE_PLAN, organization });

    await service.changePlan(ORG_ID, USER_ID, 'free');

    expect(organization.enabledModules).toEqual(['crm', 'catalog']);
    expect(organization.save).not.toHaveBeenCalled();
  });

  it('G4 — enabledModules already empty: stays empty, no write, no error', async () => {
    const organization = makeOrg([]);
    const { service } = buildService({ plan: STARTER_PLAN, organization });

    await service.changePlan(ORG_ID, USER_ID, 'starter');

    expect(organization.enabledModules).toEqual([]);
    expect(organization.save).not.toHaveBeenCalled();
  });

  it('G5 — enabledModules contains only modules the new plan still allows: kept as-is, no write', async () => {
    const organization = makeOrg(['crm', 'analytics']);
    const { service } = buildService({ plan: STARTER_PLAN, organization });

    await service.changePlan(ORG_ID, USER_ID, 'starter');

    expect(organization.enabledModules).toEqual(['crm', 'analytics']);
    expect(organization.save).not.toHaveBeenCalled();
  });

  it('does not fail the plan change itself if the organization cannot be resolved', async () => {
    const { service, update } = buildService({
      plan: STARTER_PLAN,
      organization: null,
    });

    await expect(
      service.changePlan(ORG_ID, USER_ID, 'starter'),
    ).resolves.toBeDefined();
    expect(update).toHaveBeenCalledTimes(1);
  });
});
