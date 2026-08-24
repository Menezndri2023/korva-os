import { Model } from 'mongoose';
import { MembershipsService } from './memberships.service';
import type { MembershipsRepository } from './memberships.repository';
import type { RolesService } from '../roles/roles.service';
import type { OrganizationDocument } from '../../organizations/schemas/organization.schema';

describe('MembershipsService.resolveTenantContext', () => {
  const USER_ID = 'user-1';
  const ORG_ID = 'org-1';

  function buildService(options: {
    membership?: unknown;
    role?: unknown;
    organization?: unknown;
  }) {
    const findByUserAndOrganization = jest
      .fn()
      .mockResolvedValue(options.membership ?? null);
    const membershipsRepository = {
      findByUserAndOrganization,
    } as unknown as MembershipsRepository;

    const getRoleById = jest.fn().mockResolvedValue(options.role ?? null);
    const rolesService = { getRoleById } as unknown as RolesService;

    const exec = jest.fn().mockResolvedValue(options.organization ?? null);
    const findById = jest.fn().mockReturnValue({ exec });
    const organizationModel = {
      findById,
    } as unknown as Model<OrganizationDocument>;

    return new MembershipsService(
      membershipsRepository,
      rolesService,
      organizationModel,
    );
  }

  const activeMembership = {
    status: 'active',
    roleId: { toString: () => 'role-1' },
    _id: { toString: () => 'membership-1' },
  };
  const role = {
    _id: { toString: () => 'role-1' },
    permissions: ['contacts.read'],
  };
  const organization = { enabledModules: ['crm', 'analytics'] };

  it('resolves a TenantContext that includes the organization enabledModules', async () => {
    const service = buildService({
      membership: activeMembership,
      role,
      organization,
    });

    const result = await service.resolveTenantContext(USER_ID, ORG_ID);

    expect(result).toEqual({
      userId: USER_ID,
      organizationId: ORG_ID,
      membershipId: 'membership-1',
      roleId: 'role-1',
      permissions: ['contacts.read'],
      enabledModules: ['crm', 'analytics'],
    });
  });

  it('returns null when there is no active membership — never falls back to a default enabledModules', async () => {
    const service = buildService({ membership: null, role, organization });
    expect(await service.resolveTenantContext(USER_ID, ORG_ID)).toBeNull();
  });

  it('returns null when the membership is not active, even if the organization resolves fine', async () => {
    const service = buildService({
      membership: { ...activeMembership, status: 'suspended' },
      role,
      organization,
    });
    expect(await service.resolveTenantContext(USER_ID, ORG_ID)).toBeNull();
  });

  it('returns null when the organization cannot be resolved, even if role resolves fine', async () => {
    const service = buildService({
      membership: activeMembership,
      role,
      organization: null,
    });
    expect(await service.resolveTenantContext(USER_ID, ORG_ID)).toBeNull();
  });

  it('returns null when the role cannot be resolved, even if the organization resolves fine', async () => {
    const service = buildService({
      membership: activeMembership,
      role: null,
      organization,
    });
    expect(await service.resolveTenantContext(USER_ID, ORG_ID)).toBeNull();
  });

  it('reflects an empty enabledModules as an empty array, not undefined', async () => {
    const service = buildService({
      membership: activeMembership,
      role,
      organization: { enabledModules: [] },
    });
    const result = await service.resolveTenantContext(USER_ID, ORG_ID);
    expect(result?.enabledModules).toEqual([]);
  });
});
