import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS } from '@korva/types';
import type { SystemRole } from '@korva/types';
import { RolesRepository } from './roles.repository';
import { RoleDocument } from '../schemas/role.schema';

@Injectable()
export class RolesService {
  constructor(private readonly rolesRepository: RolesRepository) {}

  /** Seeds the six system roles for a newly created organization. Called once, at organization creation. */
  async seedSystemRoles(organizationId: string): Promise<RoleDocument[]> {
    const orgObjectId = new Types.ObjectId(organizationId);
    return this.rolesRepository.insertMany(
      SYSTEM_ROLES.map((systemKey) => ({
        organizationId: orgObjectId,
        name: systemKey,
        systemKey,
        permissions: [...SYSTEM_ROLE_PERMISSIONS[systemKey]],
        isSystem: true,
      })),
    );
  }

  getRoleById(roleId: string): Promise<RoleDocument | null> {
    return this.rolesRepository.findById(roleId);
  }

  getOwnerRole(organizationId: string): Promise<RoleDocument | null> {
    return this.rolesRepository.findByOrganizationAndSystemKey(
      organizationId,
      'OWNER',
    );
  }

  /** Roles an organization admin can assign via addMember — id is the real roleId to send back. */
  async listForOrganization(
    organizationId: string,
  ): Promise<{ id: string; name: string; systemKey?: SystemRole }[]> {
    const roles =
      await this.rolesRepository.findAllForOrganization(organizationId);
    return roles.map((role) => ({
      id: role.id as string,
      name: role.name,
      systemKey: role.systemKey,
    }));
  }
}
