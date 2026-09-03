import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role, RoleDocument } from '../schemas/role.schema';

@Injectable()
export class RolesRepository {
  constructor(
    @InjectModel(Role.name) private readonly roleModel: Model<RoleDocument>,
  ) {}

  insertMany(roles: Partial<Role>[]): Promise<RoleDocument[]> {
    return this.roleModel.insertMany(roles) as unknown as Promise<
      RoleDocument[]
    >;
  }

  findById(id: string): Promise<RoleDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.roleModel.findById(id).exec();
  }

  findByOrganizationAndSystemKey(
    organizationId: string,
    systemKey: string,
  ): Promise<RoleDocument | null> {
    return this.roleModel
      .findOne({
        organizationId: new Types.ObjectId(organizationId),
        systemKey,
      })
      .exec();
  }

  findAllForOrganization(organizationId: string): Promise<RoleDocument[]> {
    return this.roleModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .exec();
  }

  create(role: Partial<Role>): Promise<RoleDocument> {
    return this.roleModel.create(role);
  }

  findByName(
    organizationId: string,
    name: string,
  ): Promise<RoleDocument | null> {
    return this.roleModel
      .findOne({ organizationId: new Types.ObjectId(organizationId), name })
      .exec();
  }

  /** Never matches a system role — `isSystem: false` in the filter, not just in the caller's
   *  own judgment, so a bug upstream can't accidentally edit/delete a seeded system role. */
  updateCustom(
    id: string,
    organizationId: string,
    updates: Partial<Pick<Role, 'name' | 'permissions'>>,
  ): Promise<RoleDocument | null> {
    return this.roleModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          isSystem: false,
        },
        updates,
        { new: true },
      )
      .exec();
  }

  deleteCustom(
    id: string,
    organizationId: string,
  ): Promise<RoleDocument | null> {
    return this.roleModel
      .findOneAndDelete({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
        isSystem: false,
      })
      .exec();
  }
}
