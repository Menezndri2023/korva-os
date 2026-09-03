import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SYSTEM_ROLES, SYSTEM_ROLE_PERMISSIONS } from '@korva/types';
import type { SystemRole } from '@korva/types';
import type { CreateRoleInput, UpdateRoleInput } from '@korva/validation';
import { RolesRepository } from './roles.repository';
import { RoleDocument } from '../schemas/role.schema';
import { Membership, MembershipDocument } from '../schemas/membership.schema';

@Injectable()
export class RolesService {
  constructor(
    private readonly rolesRepository: RolesRepository,
    // Direct model injection (not MembershipsService) — MembershipsService already depends on
    // RolesService (resolveTenantContext), so the reverse would be a same-module circular
    // provider dependency. Same established workaround this codebase uses elsewhere (CrmModule/
    // PublicModule/FinanceModule's direct Order/Cart/Booking access) rather than forwardRef().
    @InjectModel(Membership.name)
    private readonly membershipModel: Model<MembershipDocument>,
  ) {}

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

  /** Full role detail (including permissions) for the Settings roles-management UI — distinct
   *  from listForOrganization above, which stays deliberately thin for the addMember dropdown
   *  that's called it since before custom roles existed. */
  listFull(organizationId: string): Promise<RoleDocument[]> {
    return this.rolesRepository.findAllForOrganization(organizationId);
  }

  async createCustomRole(
    organizationId: string,
    input: CreateRoleInput,
  ): Promise<RoleDocument> {
    const existing = await this.rolesRepository.findByName(
      organizationId,
      input.name,
    );
    if (existing) {
      throw new ConflictException({
        code: 'ROLE_NAME_TAKEN',
        message: 'A role with this name already exists in this organization',
      });
    }
    return this.rolesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      name: input.name,
      permissions: input.permissions,
      isSystem: false,
    });
  }

  async updateCustomRole(
    organizationId: string,
    roleId: string,
    input: UpdateRoleInput,
  ): Promise<RoleDocument> {
    await this.assertEditableCustomRole(organizationId, roleId);
    if (input.name) {
      const existing = await this.rolesRepository.findByName(
        organizationId,
        input.name,
      );
      if (existing && existing.id !== roleId) {
        throw new ConflictException({
          code: 'ROLE_NAME_TAKEN',
          message: 'A role with this name already exists in this organization',
        });
      }
    }
    const updated = await this.rolesRepository.updateCustom(
      roleId,
      organizationId,
      input,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'ROLE_NOT_FOUND',
        message: 'Role not found in this organization',
      });
    }
    return updated;
  }

  async deleteCustomRole(
    organizationId: string,
    roleId: string,
  ): Promise<void> {
    await this.assertEditableCustomRole(organizationId, roleId);
    const inUse = await this.membershipModel
      .countDocuments({
        organizationId: new Types.ObjectId(organizationId),
        roleId: new Types.ObjectId(roleId),
        status: 'active',
      })
      .exec();
    if (inUse > 0) {
      throw new ConflictException({
        code: 'ROLE_IN_USE',
        message:
          'This role is currently assigned to one or more team members — reassign them before deleting it',
      });
    }
    const deleted = await this.rolesRepository.deleteCustom(
      roleId,
      organizationId,
    );
    if (!deleted) {
      throw new NotFoundException({
        code: 'ROLE_NOT_FOUND',
        message: 'Role not found in this organization',
      });
    }
  }

  /** Fails closed on both "doesn't exist" and "is a system role" — a system role's permissions
   *  are the one, org-wide-consistent contract every RBAC check in this codebase assumes;
   *  letting it be edited/deleted would silently change what e.g. every ADMIN can do. */
  private async assertEditableCustomRole(
    organizationId: string,
    roleId: string,
  ): Promise<void> {
    const role = await this.rolesRepository.findById(roleId);
    if (!role || role.organizationId.toString() !== organizationId) {
      throw new NotFoundException({
        code: 'ROLE_NOT_FOUND',
        message: 'Role not found in this organization',
      });
    }
    if (role.isSystem) {
      throw new ForbiddenException({
        code: 'SYSTEM_ROLE_IMMUTABLE',
        message: 'System roles cannot be edited or deleted',
      });
    }
  }
}
