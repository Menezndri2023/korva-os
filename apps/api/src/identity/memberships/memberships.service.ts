import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { TenantContext } from '@korva/types';
import { MembershipsRepository } from './memberships.repository';
import { RolesService } from '../roles/roles.service';
import { MembershipDocument } from '../schemas/membership.schema';
import {
  Organization,
  OrganizationDocument,
} from '../../organizations/schemas/organization.schema';

@Injectable()
export class MembershipsService {
  constructor(
    private readonly membershipsRepository: MembershipsRepository,
    private readonly rolesService: RolesService,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
  ) {}

  create(
    userId: string,
    organizationId: string,
    roleId: string,
  ): Promise<MembershipDocument> {
    return this.membershipsRepository.create({
      userId: new Types.ObjectId(userId),
      organizationId: new Types.ObjectId(organizationId),
      roleId: new Types.ObjectId(roleId),
      status: 'active',
    });
  }

  listOrganizationIdsForUser(userId: string): Promise<MembershipDocument[]> {
    return this.membershipsRepository.findAllForUser(userId);
  }

  listMembersForOrganization(
    organizationId: string,
  ): Promise<MembershipDocument[]> {
    return this.membershipsRepository.findAllForOrganization(organizationId);
  }

  countForOrganization(organizationId: string): Promise<number> {
    return this.membershipsRepository.countForOrganization(organizationId);
  }

  listActiveUserIdsForOrganization(organizationId: string): Promise<string[]> {
    return this.membershipsRepository.findActiveUserIdsForOrganization(
      organizationId,
    );
  }

  /**
   * The single source of truth for tenant isolation: resolves whether `userId` genuinely
   * belongs to `organizationId`, and if so builds the TenantContext from their real role and
   * the organization's currently enabled modules (used by ModuleGuard). Returns null if there
   * is no active membership — callers must reject the request, never fall back to a
   * client-supplied organizationId.
   *
   * Role and organization are fetched in parallel (both only depend on IDs already known once
   * the membership resolves) so this stays at two sequential round-trips, same as before
   * enabledModules was added — not three.
   */
  async resolveTenantContext(
    userId: string,
    organizationId: string,
  ): Promise<TenantContext | null> {
    const membership =
      await this.membershipsRepository.findByUserAndOrganization(
        userId,
        organizationId,
      );
    if (!membership || membership.status !== 'active') {
      return null;
    }

    const [role, organization] = await Promise.all([
      this.rolesService.getRoleById(membership.roleId.toString()),
      this.organizationModel.findById(organizationId).exec(),
    ]);
    if (!role || !organization) {
      return null;
    }

    return {
      userId,
      organizationId,
      membershipId: membership._id.toString(),
      roleId: role._id.toString(),
      permissions: role.permissions,
      enabledModules: organization.enabledModules,
    };
  }
}
