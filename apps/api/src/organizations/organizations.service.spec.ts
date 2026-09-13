import { ForbiddenException, NotFoundException } from '@nestjs/common';
import {
  OrganizationsService,
  slugify,
  deriveTaglineFromDescription,
} from './organizations.service';
import type { RolesService } from '../identity/roles/roles.service';
import type { MembershipsService } from '../identity/memberships/memberships.service';
import type { UsersService } from '../identity/users/users.service';
import type { AuditService } from '../audit/audit.service';
import type { EntitlementsService } from '../subscriptions/entitlements.service';
import type { OrganizationsRepository } from './organizations.repository';
import type { SubscriptionsService } from '../subscriptions/subscriptions.service';
import type { RoleDocument } from '../identity/schemas/role.schema';
import type { SystemRole, KorvaModule } from '@korva/types';

describe('slugify', () => {
  it('lowercases and dasherizes a simple name', () => {
    expect(slugify('Org Alpha')).toBe('org-alpha');
  });

  it('strips accents/diacritics', () => {
    expect(slugify('Café Déjà-vu')).toBe('cafe-deja-vu');
  });

  it('collapses non-alphanumeric runs into a single dash', () => {
    expect(slugify('  Multi   ---  Space!!  ')).toBe('multi-space');
  });

  it('trims leading and trailing dashes', () => {
    expect(slugify('--Edge--')).toBe('edge');
  });

  it('returns an empty string for input with no alphanumeric characters', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('deriveTaglineFromDescription (Phase E2)', () => {
  it('uses the first sentence when it fits the 200-char tagline cap', () => {
    expect(
      deriveTaglineFromDescription(
        'Nous proposons des coupes, colorations et soins bio. Ouvert du mardi au samedi.',
      ),
    ).toBe('Nous proposons des coupes, colorations et soins bio.');
  });

  it('returns the whole trimmed description when it has no sentence-ending punctuation and fits', () => {
    expect(
      deriveTaglineFromDescription(
        '  Coiffure et soins capillaires bio à Paris  ',
      ),
    ).toBe('Coiffure et soins capillaires bio à Paris');
  });

  it('hard-truncates with an ellipsis when neither the first sentence nor the whole text fits', () => {
    const longDescription = `${'x'.repeat(250)}.`;
    const result = deriveTaglineFromDescription(longDescription);
    expect(result.length).toBe(200);
    expect(result.endsWith('…')).toBe(true);
  });

  it('never invents content beyond what was entered — output is always a verbatim excerpt', () => {
    const description =
      'Plomberie, chauffage et dépannage rapide dans le 15e arrondissement.';
    expect(description).toContain(
      deriveTaglineFromDescription(description).replace('…', ''),
    );
  });
});

describe('OrganizationsService.addMember — role-hierarchy enforcement', () => {
  const ORG_ID = 'org-1';
  const OTHER_ORG_ID = 'org-2';
  const ACTOR_USER_ID = 'user-actor';
  const TARGET_USER_ID = 'user-target';
  const TARGET_EMAIL = 'target@example.com';

  function makeRole(
    id: string,
    systemKey: SystemRole | undefined,
    organizationId: string = ORG_ID,
  ): RoleDocument {
    return {
      id,
      systemKey,
      organizationId: { toString: () => organizationId },
    } as unknown as RoleDocument;
  }

  const roles: Record<string, RoleDocument> = {
    'role-owner': makeRole('role-owner', 'OWNER'),
    'role-admin': makeRole('role-admin', 'ADMIN'),
    'role-manager': makeRole('role-manager', 'MANAGER'),
    'role-sales': makeRole('role-sales', 'SALES'),
    'role-finance': makeRole('role-finance', 'FINANCE'),
    'role-staff': makeRole('role-staff', 'STAFF'),
    'role-custom': makeRole('role-custom', undefined),
    'role-other-org-owner': makeRole(
      'role-other-org-owner',
      'OWNER',
      OTHER_ORG_ID,
    ),
  };

  function buildService() {
    const getRoleById = jest.fn((id: string) =>
      Promise.resolve(roles[id] ?? null),
    );
    const rolesService = { getRoleById } as unknown as RolesService;

    const create = jest.fn().mockResolvedValue({ id: 'membership-1' });
    const membershipsService = { create } as unknown as MembershipsService;

    const findByEmail = jest
      .fn()
      .mockResolvedValue({ id: TARGET_USER_ID, email: TARGET_EMAIL });
    const usersService = { findByEmail } as unknown as UsersService;

    const record = jest.fn().mockResolvedValue(undefined);
    const auditService = { record } as unknown as AuditService;

    const assertSeatAvailable = jest.fn().mockResolvedValue(undefined);
    const entitlementsService = {
      assertSeatAvailable,
    } as unknown as EntitlementsService;

    const service = new OrganizationsService(
      {} as OrganizationsRepository,
      rolesService,
      membershipsService,
      usersService,
      auditService,
      {} as SubscriptionsService,
      entitlementsService,
    );

    return { service, create };
  }

  function attempt(actorRoleId: string, targetRoleId: string) {
    const { service, create } = buildService();
    const promise = service.addMember(ORG_ID, ACTOR_USER_ID, actorRoleId, {
      email: TARGET_EMAIL,
      roleId: targetRoleId,
    });
    return { promise, create };
  }

  it('TEST 1 (critical): ADMIN cannot assign OWNER — 403, no membership created', async () => {
    const { promise, create } = attempt('role-admin', 'role-owner');
    await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('TEST 2: OWNER can assign OWNER', async () => {
    const { promise, create } = attempt('role-owner', 'role-owner');
    await expect(promise).resolves.toEqual({ id: 'membership-1' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('TEST 3: ADMIN can assign ADMIN', async () => {
    const { promise, create } = attempt('role-admin', 'role-admin');
    await expect(promise).resolves.toEqual({ id: 'membership-1' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('TEST 4: ADMIN can assign MANAGER', async () => {
    const { promise, create } = attempt('role-admin', 'role-manager');
    await expect(promise).resolves.toEqual({ id: 'membership-1' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('TEST 5: ADMIN can assign SALES', async () => {
    const { promise, create } = attempt('role-admin', 'role-sales');
    await expect(promise).resolves.toEqual({ id: 'membership-1' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('TEST 6: ADMIN can assign FINANCE', async () => {
    const { promise, create } = attempt('role-admin', 'role-finance');
    await expect(promise).resolves.toEqual({ id: 'membership-1' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('TEST 7: ADMIN can assign STAFF', async () => {
    const { promise, create } = attempt('role-admin', 'role-staff');
    await expect(promise).resolves.toEqual({ id: 'membership-1' });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('TEST 8: MANAGER cannot assign ADMIN — 403', async () => {
    const { promise, create } = attempt('role-manager', 'role-admin');
    await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('TEST 9: MANAGER cannot assign OWNER — 403', async () => {
    const { promise, create } = attempt('role-manager', 'role-owner');
    await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('TEST 10: STAFF cannot assign OWNER — 403', async () => {
    const { promise, create } = attempt('role-staff', 'role-owner');
    await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('TEST 11: a roleId belonging to another organization is still ROLE_NOT_FOUND, no membership created', async () => {
    const { promise, create } = attempt('role-owner', 'role-other-org-owner');
    await expect(promise).rejects.toBeInstanceOf(NotFoundException);
    expect(create).not.toHaveBeenCalled();
  });

  it('TEST 12: an actor holding an unknown/custom role (no systemKey) fails closed with 403, no membership created — regardless of the target role', async () => {
    const asActor = attempt('role-custom', 'role-staff');
    await expect(asActor.promise).rejects.toBeInstanceOf(ForbiddenException);
    expect(asActor.create).not.toHaveBeenCalled();
  });

  it('TEST 13: ADMIN still cannot assign a custom (no-systemKey) role — only OWNER gets that escape hatch', async () => {
    const { promise, create } = attempt('role-admin', 'role-custom');
    await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('TEST 14: OWNER CAN assign a custom (no-systemKey) role — the one deliberate escape hatch backing organization-defined custom roles', async () => {
    const { promise, create } = attempt('role-owner', 'role-custom');
    await expect(promise).resolves.toEqual({ id: 'membership-1' });
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe('OrganizationsService.createForOwner — default enabledModules (P0-ORG-01)', () => {
  const OWNER_USER_ID = 'user-owner';
  const ORG_ID = 'org-new';
  const OWNER_ROLE_ID = 'role-owner';

  const CREATE_INPUT = {
    name: 'New Org',
    type: 'commerce',
    country: 'FR',
    currency: 'EUR',
    timezone: 'Europe/Paris',
    language: 'fr',
  };

  function buildService(planModules: KorvaModule[]) {
    const created = { id: ORG_ID, name: CREATE_INPUT.name, enabledModules: [] };
    const countBySlugPrefix = jest.fn().mockResolvedValue(0);
    const create = jest.fn().mockResolvedValue(created);
    const update = jest
      .fn()
      .mockImplementation((id: string, data) =>
        Promise.resolve({ ...created, ...data }),
      );
    const organizationsRepository = {
      countBySlugPrefix,
      create,
      update,
    } as unknown as OrganizationsRepository;

    const seedSystemRoles = jest.fn().mockResolvedValue(undefined);
    const getOwnerRole = jest.fn().mockResolvedValue({ id: OWNER_ROLE_ID });
    const rolesService = {
      seedSystemRoles,
      getOwnerRole,
    } as unknown as RolesService;

    const membershipCreate = jest
      .fn()
      .mockResolvedValue({ id: 'membership-1' });
    const membershipsService = {
      create: membershipCreate,
    } as unknown as MembershipsService;

    const usersService = {} as unknown as UsersService;

    const record = jest.fn().mockResolvedValue(undefined);
    const auditService = { record } as unknown as AuditService;

    const createDefaultSubscription = jest
      .fn()
      .mockResolvedValue({ id: 'sub-1' });
    const getActivePlan = jest.fn().mockResolvedValue({
      key: 'free',
      name: 'Free',
      modules: planModules,
      limits: { seats: 3 },
    });
    const subscriptionsService = {
      createDefaultSubscription,
      getActivePlan,
    } as unknown as SubscriptionsService;

    const entitlementsService = {} as unknown as EntitlementsService;

    const service = new OrganizationsService(
      organizationsRepository,
      rolesService,
      membershipsService,
      usersService,
      auditService,
      subscriptionsService,
      entitlementsService,
    );

    return { service, update, createDefaultSubscription, getActivePlan };
  }

  it('defaults enabledModules to the resolved plan modules, not a hardcoded or empty list', async () => {
    const planModules: KorvaModule[] = [
      'crm',
      'catalog',
      'booking',
      'commerce',
      'finance',
      'workflow',
      'communication',
      'analytics',
      'ai',
    ];
    const { service, update, createDefaultSubscription, getActivePlan } =
      buildService(planModules);

    const result = await service.createForOwner(OWNER_USER_ID, CREATE_INPUT);

    // The plan must be resolved only after the default subscription is created.
    expect(createDefaultSubscription).toHaveBeenCalledWith(ORG_ID);
    expect(getActivePlan).toHaveBeenCalledWith(ORG_ID);
    expect(update).toHaveBeenCalledWith(ORG_ID, {
      enabledModules: planModules,
    });
    expect(result.enabledModules).toEqual(planModules);
  });

  it('never grants more modules than the resolved plan allows, even for a restricted plan', async () => {
    const starterModules: KorvaModule[] = [
      'crm',
      'catalog',
      'booking',
      'commerce',
      'finance',
      'communication',
      'analytics',
    ];
    const { service, update } = buildService(starterModules);

    const result = await service.createForOwner(OWNER_USER_ID, CREATE_INPUT);

    expect(update).toHaveBeenCalledWith(ORG_ID, {
      enabledModules: starterModules,
    });
    expect(result.enabledModules).not.toContain('workflow');
    expect(result.enabledModules).not.toContain('ai');
  });
});
