import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Membership, MembershipDocument } from '../schemas/membership.schema';

@Injectable()
export class MembershipsRepository {
  constructor(
    @InjectModel(Membership.name)
    private readonly membershipModel: Model<MembershipDocument>,
  ) {}

  create(data: Partial<Membership>): Promise<MembershipDocument> {
    return this.membershipModel.create(data);
  }

  findByUserAndOrganization(
    userId: string,
    organizationId: string,
  ): Promise<MembershipDocument | null> {
    if (
      !Types.ObjectId.isValid(userId) ||
      !Types.ObjectId.isValid(organizationId)
    ) {
      return Promise.resolve(null);
    }
    return this.membershipModel
      .findOne({
        userId: new Types.ObjectId(userId),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  findAllForUser(userId: string): Promise<MembershipDocument[]> {
    return this.membershipModel
      .find({ userId: new Types.ObjectId(userId), status: 'active' })
      .exec();
  }

  findAllForOrganization(
    organizationId: string,
  ): Promise<MembershipDocument[]> {
    return this.membershipModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .populate('userId', 'email firstName lastName')
      .populate('roleId', 'name systemKey')
      .exec();
  }

  countForOrganization(organizationId: string): Promise<number> {
    return this.membershipModel
      .countDocuments({ organizationId: new Types.ObjectId(organizationId) })
      .exec();
  }

  /** Unpopulated, unlike findAllForOrganization — callers only need the raw active member ids (e.g. broadcasting a Notification). */
  async findActiveUserIdsForOrganization(
    organizationId: string,
  ): Promise<string[]> {
    const memberships = await this.membershipModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        status: 'active',
      })
      .select('userId')
      .exec();
    return memberships.map((membership) => membership.userId.toString());
  }
}
