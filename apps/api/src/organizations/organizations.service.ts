import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AddMemberInput,
  CreateOrganizationInput,
  UpdateOrganizationInput,
} from '@korva/validation';
import { SYSTEM_ROLE_RANK } from '@korva/types';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationDocument } from './schemas/organization.schema';
import { RolesService } from '../identity/roles/roles.service';
import { RoleDocument } from '../identity/schemas/role.schema';
import { MembershipsService } from '../identity/memberships/memberships.service';
import { UsersService } from '../identity/users/users.service';
import { AuditService } from '../audit/audit.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { EntitlementsService } from '../subscriptions/entitlements.service';

/**
 * Rank of a role for role-assignment hierarchy purposes only (see addMember). Custom roles
 * (no systemKey, or an unrecognized one) have no known rank and must never be assumed to
 * outrank anything — callers must fail closed rather than fall back to a permissive default.
 */
export function requireSystemRoleRank(role: RoleDocument): number {
  const rank = role.systemKey ? SYSTEM_ROLE_RANK[role.systemKey] : undefined;
  if (rank === undefined) {
    throw new ForbiddenException({
      code: 'ROLE_HIERARCHY_UNKNOWN',
      message: 'You cannot assign a role with higher privileges than your own.',
    });
  }
  return rank;
}

const DIACRITICS_PATTERN = new RegExp('[\\u0300-\\u036f]', 'g');

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(DIACRITICS_PATTERN, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly organizationsRepository: OrganizationsRepository,
    private readonly rolesService: RolesService,
    private readonly membershipsService: MembershipsService,
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly entitlementsService: EntitlementsService,
  ) {}

  async createForOwner(
    ownerUserId: string,
    input: CreateOrganizationInput,
  ): Promise<OrganizationDocument> {
    const baseSlug = slugify(input.name) || 'organization';
    const existingCount =
      await this.organizationsRepository.countBySlugPrefix(baseSlug);
    const slug =
      existingCount === 0 ? baseSlug : `${baseSlug}-${existingCount + 1}`;

    const organization = await this.organizationsRepository.create({
      name: input.name,
      slug,
      type: input.type,
      country: input.country,
      currency: input.currency,
      timezone: input.timezone,
      language: input.language,
      settings: { onboardingCompleted: false },
      enabledModules: [],
    });

    await this.rolesService.seedSystemRoles(organization.id as string);
    const ownerRole = await this.rolesService.getOwnerRole(
      organization.id as string,
    );
    if (!ownerRole) {
      throw new Error('Failed to seed OWNER role for new organization');
    }

    await this.membershipsService.create(
      ownerUserId,
      organization.id as string,
      ownerRole.id as string,
    );

    await this.subscriptionsService.createDefaultSubscription(
      organization.id as string,
    );

    // A freshly created organization must default to every module its assigned plan
    // actually allows, not an empty set — otherwise every module (CRM, Catalog, Booking,
    // Commerce, Finance, Analytics, Workflow, Communication, AI) stays undiscoverable until
    // someone opts each one in manually via Settings. The plan can only be resolved once the
    // default subscription above exists, and enabledModules must always stay a subset of the
    // plan's own module list (never a hardcoded literal — see EntitlementsService.assertModulesAllowed).
    const plan = await this.subscriptionsService.getActivePlan(
      organization.id as string,
    );
    const withDefaultModules = await this.organizationsRepository.update(
      organization.id as string,
      { enabledModules: plan.modules },
    );
    if (!withDefaultModules) {
      throw new Error('Failed to enable default modules for new organization');
    }

    await this.auditService.record({
      organizationId: organization.id as string,
      userId: ownerUserId,
      action: 'CREATE',
      entity: 'organization',
      entityId: organization.id as string,
      metadata: { name: organization.name },
    });

    return withDefaultModules;
  }

  async getBySlug(slug: string): Promise<OrganizationDocument> {
    const organization = await this.organizationsRepository.findBySlug(slug);
    if (!organization) {
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found',
      });
    }
    return organization;
  }

  async getById(id: string): Promise<OrganizationDocument> {
    const organization = await this.organizationsRepository.findById(id);
    if (!organization) {
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found',
      });
    }
    return organization;
  }

  async listForUser(userId: string): Promise<OrganizationDocument[]> {
    const memberships =
      await this.membershipsService.listOrganizationIdsForUser(userId);
    if (memberships.length === 0) return [];
    return this.organizationsRepository.findByIds(
      memberships.map((m) => m.organizationId.toString()),
    );
  }

  async update(
    id: string,
    input: UpdateOrganizationInput,
  ): Promise<OrganizationDocument> {
    if (input.enabledModules) {
      await this.entitlementsService.assertModulesAllowed(
        id,
        input.enabledModules,
      );
    }
    if (input.name) {
      const existing = await this.organizationsRepository.findBySlug(
        slugify(input.name),
      );
      if (existing && existing.id !== id) {
        throw new ConflictException({
          code: 'SLUG_TAKEN',
          message: 'Organization name already in use',
        });
      }
    }
    const organization = await this.organizationsRepository.update(id, input);
    if (!organization) {
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found',
      });
    }
    return organization;
  }

  listMembers(organizationId: string) {
    return this.membershipsService.listMembersForOrganization(organizationId);
  }

  listRoles(organizationId: string) {
    return this.rolesService.listForOrganization(organizationId);
  }

  async addMember(
    organizationId: string,
    actorUserId: string,
    actorRoleId: string,
    input: AddMemberInput,
  ) {
    await this.entitlementsService.assertSeatAvailable(organizationId);

    const user = await this.usersService.findByEmail(input.email);
    if (!user) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'No user found with this email',
      });
    }

    const role = await this.rolesService.getRoleById(input.roleId);
    if (!role || role.organizationId.toString() !== organizationId) {
      throw new NotFoundException({
        code: 'ROLE_NOT_FOUND',
        message: 'Role not found in this organization',
      });
    }

    const actorRole = await this.rolesService.getRoleById(actorRoleId);
    if (!actorRole) {
      throw new ForbiddenException({
        code: 'ROLE_HIERARCHY_UNKNOWN',
        message:
          'You cannot assign a role with higher privileges than your own.',
      });
    }
    if (requireSystemRoleRank(actorRole) > requireSystemRoleRank(role)) {
      throw new ForbiddenException({
        code: 'ROLE_HIERARCHY_VIOLATION',
        message:
          'You cannot assign a role with higher privileges than your own.',
      });
    }

    const membership = await this.membershipsService.create(
      user.id as string,
      organizationId,
      input.roleId,
    );

    await this.auditService.record({
      organizationId,
      userId: actorUserId,
      action: 'CREATE',
      entity: 'membership',
      entityId: membership.id as string,
      metadata: { invitedUserId: user.id, roleId: input.roleId },
    });

    return membership;
  }

  /**
   * Changes an existing member's role. Same hierarchy invariant as addMember (an actor can never
   * assign a role that outranks their own), extended with a second check addMember doesn't need:
   * the membership's CURRENT role must also not outrank the actor — otherwise an ADMIN could
   * demote an OWNER despite never being allowed to grant OWNER-rank access in the first place.
   * Also guards against demoting an organization's last active OWNER, which would otherwise leave
   * the org with no one able to manage it.
   */
  async updateMemberRole(
    organizationId: string,
    actorUserId: string,
    actorRoleId: string,
    membershipId: string,
    newRoleId: string,
  ) {
    const membership = await this.membershipsService.findByIdForOrganization(
      membershipId,
      organizationId,
    );
    if (!membership) {
      throw new NotFoundException({
        code: 'MEMBERSHIP_NOT_FOUND',
        message: 'Membership not found',
      });
    }

    const newRole = await this.rolesService.getRoleById(newRoleId);
    if (!newRole || newRole.organizationId.toString() !== organizationId) {
      throw new NotFoundException({
        code: 'ROLE_NOT_FOUND',
        message: 'Role not found in this organization',
      });
    }

    const actorRole = await this.rolesService.getRoleById(actorRoleId);
    if (!actorRole) {
      throw new ForbiddenException({
        code: 'ROLE_HIERARCHY_UNKNOWN',
        message:
          'You cannot assign a role with higher privileges than your own.',
      });
    }
    const currentRole = membership.roleId as unknown as RoleDocument;
    if (
      requireSystemRoleRank(actorRole) > requireSystemRoleRank(newRole) ||
      requireSystemRoleRank(actorRole) > requireSystemRoleRank(currentRole)
    ) {
      throw new ForbiddenException({
        code: 'ROLE_HIERARCHY_VIOLATION',
        message:
          'You cannot assign a role with higher privileges than your own.',
      });
    }

    if (
      currentRole.systemKey === 'OWNER' &&
      newRole.systemKey !== 'OWNER' &&
      (await this.membershipsService.countActiveByRole(
        organizationId,
        currentRole.id as string,
      )) <= 1
    ) {
      throw new ForbiddenException({
        code: 'CANNOT_DEMOTE_LAST_OWNER',
        message: 'An organization must always have at least one owner.',
      });
    }

    const updated = await this.membershipsService.updateRole(
      membershipId,
      newRoleId,
    );

    await this.auditService.record({
      organizationId,
      userId: actorUserId,
      action: 'ROLE_CHANGE',
      entity: 'membership',
      entityId: membershipId,
      metadata: { previousRoleId: currentRole.id as string, roleId: newRoleId },
    });

    return updated;
  }

  /**
   * Sets a member's default hourly rate — pre-fills TimeEntry.hourlyRate for that staff member
   * when a time entry omits one (see TimeEntriesService.create). Unlike updateMemberRole, this
   * carries no privilege-hierarchy concern (a rate is a billing detail, not an access level), so
   * the only guard needed is that the membership actually belongs to this organization.
   */
  async updateMemberRate(
    organizationId: string,
    actorUserId: string,
    membershipId: string,
    defaultHourlyRate: number,
  ) {
    const membership = await this.membershipsService.findByIdForOrganization(
      membershipId,
      organizationId,
    );
    if (!membership) {
      throw new NotFoundException({
        code: 'MEMBERSHIP_NOT_FOUND',
        message: 'Membership not found',
      });
    }

    const updated = await this.membershipsService.updateDefaultHourlyRate(
      membershipId,
      defaultHourlyRate,
    );

    await this.auditService.record({
      organizationId,
      userId: actorUserId,
      action: 'UPDATE',
      entity: 'membership',
      entityId: membershipId,
      metadata: { defaultHourlyRate },
    });

    return updated;
  }

  /**
   * Removes a member — a status change to 'suspended', never a delete (same revoke-not-delete
   * convention as invitations/integration accounts). Guards: an actor can never remove someone
   * who outranks them, can never remove themselves via this route (self-removal from the org
   * they're managing is not this action's job), and can never remove an organization's last
   * active OWNER.
   */
  async removeMember(
    organizationId: string,
    actorUserId: string,
    actorRoleId: string,
    membershipId: string,
  ) {
    const membership = await this.membershipsService.findByIdForOrganization(
      membershipId,
      organizationId,
    );
    if (!membership) {
      throw new NotFoundException({
        code: 'MEMBERSHIP_NOT_FOUND',
        message: 'Membership not found',
      });
    }

    // membership.userId is POPULATED here (findByIdForOrganization populates it) — it is a full
    // User sub-document at runtime despite the schema's static ObjectId type, so `.toString()`
    // would stringify the object itself, not its id. `.id` is Mongoose's own virtual getter
    // (present on every hydrated document by default), the same accessor already relied on for
    // `currentRole.id` below.
    const memberUserId = (membership.userId as unknown as { id: string }).id;
    if (memberUserId === actorUserId) {
      throw new ForbiddenException({
        code: 'CANNOT_REMOVE_SELF',
        message: 'You cannot remove your own membership.',
      });
    }

    const actorRole = await this.rolesService.getRoleById(actorRoleId);
    const currentRole = membership.roleId as unknown as RoleDocument;
    if (
      !actorRole ||
      requireSystemRoleRank(actorRole) > requireSystemRoleRank(currentRole)
    ) {
      throw new ForbiddenException({
        code: 'ROLE_HIERARCHY_VIOLATION',
        message:
          'You cannot remove a member with higher privileges than your own.',
      });
    }

    // No separate "last owner" count guard here (unlike updateMemberRole, which does need one):
    // the hierarchy check above only lets an OWNER-ranked actor remove an OWNER-ranked target
    // (nothing outranks OWNER, so no lower-ranked actor can ever pass it), and CANNOT_REMOVE_SELF
    // above already rejects an owner removing their own membership. Combined, the only way to
    // reach "removing the organization's last active owner" would require the actor and target
    // to be the same single remaining owner — which CANNOT_REMOVE_SELF already blocks. A distinct
    // count-based check here would be unreachable dead code, not real defense-in-depth.

    const updated = await this.membershipsService.updateStatus(
      membershipId,
      'suspended',
    );

    await this.auditService.record({
      organizationId,
      userId: actorUserId,
      action: 'DELETE',
      entity: 'membership',
      entityId: membershipId,
      metadata: { removedUserId: memberUserId },
    });

    return updated;
  }
}
