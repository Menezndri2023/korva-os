import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { MembershipStatus } from '@korva/types';
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

  /**
   * Counts the memberships that OCCUPY A SEAT, which is not the same as counting membership
   * documents — the distinction this method exists to make.
   *
   * `removeMember` suspends rather than deletes, deliberately: the audit trail and anything
   * attributed to that person must survive them leaving. But this count is what
   * EntitlementsService compares to `plan.limits.seats`, and it used to count every document
   * regardless of status — so removing a member never freed their seat, and a Starter customer
   * who let someone go was still told their plan was full.
   *
   * `invited` DOES occupy a seat. An outstanding invitation is a seat promised to someone, and
   * excluding it would let one seat invite a hundred people.
   */
  countSeatsForOrganization(organizationId: string): Promise<number> {
    return this.membershipModel
      .countDocuments({
        organizationId: new Types.ObjectId(organizationId),
        status: { $ne: 'suspended' },
      })
      .exec();
  }

  /** Same populate shape as findAllForOrganization — every read of a single membership the
   *  Team-management surface exposes must return the same resolved (userId, roleId) shape the
   *  list already does, not a raw ObjectId-only document. Org-scoped in the same query
   *  (organizationId in the filter), never as a separate after-the-fact check — mirrors
   *  IntegrationsRepository.findByIdForOrganization's own precedent. */
  findByIdForOrganization(
    id: string,
    organizationId: string,
  ): Promise<MembershipDocument | null> {
    if (
      !Types.ObjectId.isValid(id) ||
      !Types.ObjectId.isValid(organizationId)
    ) {
      return Promise.resolve(null);
    }
    return this.membershipModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .populate('userId', 'email firstName lastName')
      .populate('roleId', 'name systemKey')
      .exec();
  }

  /**
   * Brings a suspended membership back as `active` with a (possibly new) role, in one update.
   *
   * Re-hiring somebody used to return a 500: `create` always inserts and the unique index on
   * (userId, organizationId) rejected the second document, surfacing as an unhandled
   * MongoServerError because nothing maps duplicate keys. Reusing the SAME document is also the
   * better answer on its own terms — the audit trail and anything attributed to that membership
   * stay attached to it instead of being orphaned beside a new row.
   */
  reactivate(id: string, roleId: string): Promise<MembershipDocument | null> {
    return this.membershipModel
      .findByIdAndUpdate(
        id,
        { status: 'active', roleId: new Types.ObjectId(roleId) },
        { new: true },
      )
      .populate('userId', 'email firstName lastName')
      .populate('roleId', 'name systemKey')
      .exec();
  }

  updateRole(id: string, roleId: string): Promise<MembershipDocument | null> {
    return this.membershipModel
      .findByIdAndUpdate(
        id,
        { roleId: new Types.ObjectId(roleId) },
        { new: true },
      )
      .populate('userId', 'email firstName lastName')
      .populate('roleId', 'name systemKey')
      .exec();
  }

  updateDefaultHourlyRate(
    id: string,
    defaultHourlyRate: number,
  ): Promise<MembershipDocument | null> {
    return this.membershipModel
      .findByIdAndUpdate(id, { defaultHourlyRate }, { new: true })
      .populate('userId', 'email firstName lastName')
      .populate('roleId', 'name systemKey')
      .exec();
  }

  updateCommissionRate(
    id: string,
    commissionRateBasisPoints: number,
  ): Promise<MembershipDocument | null> {
    return this.membershipModel
      .findByIdAndUpdate(id, { commissionRateBasisPoints }, { new: true })
      .populate('userId', 'email firstName lastName')
      .populate('roleId', 'name systemKey')
      .exec();
  }

  /** Removal is a status change ('suspended'), never a delete — same revoke-not-delete
   *  convention as invitations/integration accounts elsewhere in this codebase. A suspended
   *  membership is excluded from findAllForUser/findActiveUserIdsForOrganization (both already
   *  filter status:'active'), so this alone is what actually revokes the person's access. */
  updateStatus(
    id: string,
    status: MembershipStatus,
  ): Promise<MembershipDocument | null> {
    return this.membershipModel
      .findByIdAndUpdate(id, { status }, { new: true })
      .populate('userId', 'email firstName lastName')
      .populate('roleId', 'name systemKey')
      .exec();
  }

  /** Used to guard against demoting/removing an organization's last active OWNER. */
  countActiveByRole(organizationId: string, roleId: string): Promise<number> {
    return this.membershipModel
      .countDocuments({
        organizationId: new Types.ObjectId(organizationId),
        roleId: new Types.ObjectId(roleId),
        status: 'active',
      })
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
