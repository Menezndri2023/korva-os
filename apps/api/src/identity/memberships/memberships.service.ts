import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import type { TenantContext } from '@korva/types';
import { MembershipsRepository } from './memberships.repository';
import { RolesService } from '../roles/roles.service';
import { MembershipDocument } from '../schemas/membership.schema';

@Injectable()
export class MembershipsService {
  constructor(
    private readonly membershipsRepository: MembershipsRepository,
    private readonly rolesService: RolesService,
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

  /**
   * The single source of truth for tenant isolation: resolves whether `userId` genuinely
   * belongs to `organizationId`, and if so builds the TenantContext from their real role.
   * Returns null if there is no active membership — callers must reject the request, never
   * fall back to a client-supplied organizationId.
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

    const role = await this.rolesService.getRoleById(
      membership.roleId.toString(),
    );
    if (!role) {
      return null;
    }

    return {
      userId,
      organizationId,
      membershipId: membership._id.toString(),
      roleId: role._id.toString(),
      permissions: role.permissions,
    };
  }
}
