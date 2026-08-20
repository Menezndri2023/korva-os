import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AddMemberInput,
  CreateOrganizationInput,
  UpdateOrganizationInput,
} from '@korva/validation';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationDocument } from './schemas/organization.schema';
import { RolesService } from '../identity/roles/roles.service';
import { MembershipsService } from '../identity/memberships/memberships.service';
import { UsersService } from '../identity/users/users.service';
import { AuditService } from '../audit/audit.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { EntitlementsService } from '../subscriptions/entitlements.service';

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

    await this.auditService.record({
      organizationId: organization.id as string,
      userId: ownerUserId,
      action: 'CREATE',
      entity: 'organization',
      entityId: organization.id as string,
      metadata: { name: organization.name },
    });

    return organization;
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

  async addMember(
    organizationId: string,
    actorUserId: string,
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
}
