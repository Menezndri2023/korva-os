import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Organization } from '../organizations/schemas/organization.schema';
import { Offer } from '../catalog/offers/schemas/offer.schema';
import { Membership } from '../identity/schemas/membership.schema';
import { User } from '../identity/schemas/user.schema';
import { Session } from '../identity/schemas/session.schema';

const DAY_MS = 24 * 60 * 60 * 1000;
export const INACTIVE_AFTER_DAYS = 7;
const REPORT_LIMIT = 300;

export interface ActivationRow {
  id: string;
  name: string;
  slug: string;
  businessModel?: string;
  createdAt: Date;
  ownerEmail: string | null;
  activeOffers: number;
  hasLogo: boolean;
  hasWhatsapp: boolean;
  websiteEnabled: boolean;
  /** Most recent session activity of any member — an approximation: a session's updatedAt moves
   *  when its refresh token rotates, i.e. when someone actually uses the dashboard. */
  lastActivityAt: Date | null;
  nudgedAt: Date | null;
  /** What needs a hand, in plain words, for the operator's follow-up. */
  issues: ('site_vide' | 'sans_logo' | 'sans_whatsapp' | 'inactif')[];
}

/**
 * KORVA's own view of its customers' activation: which shops have an empty site, no logo, no
 * WhatsApp, or nobody logging in for a week — the list to call or message.
 *
 * Served by the KORVA administration (PlatformAdminController), behind PlatformAdminGuard.
 */
@Injectable()
export class ActivationReportService {
  constructor(
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    @InjectModel(Offer.name) private readonly offerModel: Model<Offer>,
    @InjectModel(Membership.name)
    private readonly membershipModel: Model<Membership>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @InjectModel(Session.name) private readonly sessionModel: Model<Session>,
  ) {}

  async report(now: Date = new Date()): Promise<ActivationRow[]> {
    const organizations = await this.organizationModel
      .find(
        {},
        {
          name: 1,
          slug: 1,
          businessModel: 1,
          createdAt: 1,
          logo: 1,
          whatsappNumber: 1,
          enabledModules: 1,
          activationNudgeSentAt: 1,
        },
      )
      .sort({ createdAt: -1 })
      .limit(REPORT_LIMIT)
      .lean<
        {
          _id: Types.ObjectId;
          name: string;
          slug: string;
          businessModel?: string;
          createdAt: Date;
          logo?: string;
          whatsappNumber?: string;
          enabledModules?: string[];
          activationNudgeSentAt?: Date;
        }[]
      >()
      .exec();
    const ids = organizations.map((org) => org._id);

    const [offerCounts, memberships] = await Promise.all([
      this.offerModel
        .aggregate<{ _id: Types.ObjectId; count: number }>([
          { $match: { organizationId: { $in: ids }, status: 'active' } },
          { $group: { _id: '$organizationId', count: { $sum: 1 } } },
        ])
        .exec(),
      this.membershipModel
        .find(
          { organizationId: { $in: ids }, status: 'active' },
          { organizationId: 1, userId: 1, createdAt: 1 },
        )
        .sort({ createdAt: 1 })
        .lean<{ organizationId: Types.ObjectId; userId: Types.ObjectId }[]>()
        .exec(),
    ]);

    const userIds = [
      ...new Set(memberships.map((m) => m.userId.toString())),
    ].map((id) => new Types.ObjectId(id));
    const [users, activity] = await Promise.all([
      this.userModel
        .find({ _id: { $in: userIds } }, { email: 1 })
        .lean<{ _id: Types.ObjectId; email: string }[]>()
        .exec(),
      this.sessionModel
        .aggregate<{ _id: Types.ObjectId; last: Date }>([
          { $match: { userId: { $in: userIds } } },
          { $group: { _id: '$userId', last: { $max: '$updatedAt' } } },
        ])
        .exec(),
    ]);

    const offersByOrg = new Map(
      offerCounts.map((row) => [row._id.toString(), row.count]),
    );
    const emailByUser = new Map(
      users.map((user) => [user._id.toString(), user.email]),
    );
    const lastByUser = new Map(
      activity.map((row) => [row._id.toString(), row.last]),
    );
    const membersByOrg = new Map<string, string[]>();
    for (const membership of memberships) {
      const key = membership.organizationId.toString();
      membersByOrg.set(key, [
        ...(membersByOrg.get(key) ?? []),
        membership.userId.toString(),
      ]);
    }

    return organizations.map((org) => {
      const id = org._id.toString();
      const members = membersByOrg.get(id) ?? [];
      const lastActivityAt =
        members
          .map((userId) => lastByUser.get(userId))
          .filter((date): date is Date => Boolean(date))
          .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      const activeOffers = offersByOrg.get(id) ?? 0;
      const websiteEnabled = (org.enabledModules ?? []).includes('website');
      const issues: ActivationRow['issues'] = [];
      if (websiteEnabled && activeOffers === 0) issues.push('site_vide');
      if (!org.logo) issues.push('sans_logo');
      if (!org.whatsappNumber) issues.push('sans_whatsapp');
      if (
        !lastActivityAt ||
        now.getTime() - lastActivityAt.getTime() > INACTIVE_AFTER_DAYS * DAY_MS
      ) {
        issues.push('inactif');
      }
      return {
        id,
        name: org.name,
        slug: org.slug,
        businessModel: org.businessModel,
        createdAt: org.createdAt,
        ownerEmail: members[0] ? (emailByUser.get(members[0]) ?? null) : null,
        activeOffers,
        hasLogo: Boolean(org.logo),
        hasWhatsapp: Boolean(org.whatsappNumber),
        websiteEnabled,
        lastActivityAt,
        nudgedAt: org.activationNudgeSentAt ?? null,
        issues,
      };
    });
  }
}
