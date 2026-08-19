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
}
