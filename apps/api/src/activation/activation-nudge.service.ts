import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from '../communication/providers/email-provider.interface';
import { Organization } from '../organizations/schemas/organization.schema';
import { Offer } from '../catalog/offers/schemas/offer.schema';
import { Membership } from '../identity/schemas/membership.schema';
import { User } from '../identity/schemas/user.schema';
import { interpolate } from '../shared/template';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Old enough to have had a fair chance on their own; young enough that a reminder still lands. */
export const NUDGE_MIN_AGE_DAYS = 2;
export const NUDGE_MAX_AGE_DAYS = 7;

const SUBJECT = 'Votre site est prêt, il ne lui manque qu’une offre';
const BODY_TEMPLATE =
  '<p>Bonjour,</p>' +
  '<p>Le site de <strong>{{organizationName}}</strong> est créé, mais aucune offre n’y est encore en ligne : vos clients voient pour l’instant une page vide.</p>' +
  '<p>Une seule offre suffit pour commencer — un nom, un prix et une photo prise avec votre téléphone, en deux minutes.</p>' +
  '<p><a href="{{catalogUrl}}">Mettre ma première offre en ligne</a></p>' +
  '<p>À bientôt sur KORVA.</p>';

export interface NudgeSweepResult {
  candidates: number;
  sent: number;
}

/**
 * One reminder, two days after signup, to an owner whose public site still has no offer online.
 *
 * Why it exists: the first real customer stayed for weeks with a single draft offer and a site
 * that showed nothing, and nothing in the product said so. The onboarding now asks for a first
 * offer (apps/web onboarding/first-offer), but that step can be skipped; this catches the ones
 * who did.
 *
 * Claim-then-send: `activationNudgeSentAt` is set by a conditional update BEFORE the email goes
 * out, so two API instances running the sweep at once never both send. The price is that a
 * failed send is not retried — a missed reminder is better than a duplicated one.
 *
 * Reads the models directly rather than through the owning modules' repositories, so this module
 * depends on nothing but schemas and the email provider and cannot create an import cycle.
 */
@Injectable()
export class ActivationNudgeService {
  private readonly logger = new Logger(ActivationNudgeService.name);

  constructor(
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    @InjectModel(Offer.name) private readonly offerModel: Model<Offer>,
    @InjectModel(Membership.name)
    private readonly membershipModel: Model<Membership>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    private readonly configService: ConfigService,
  ) {}

  async sendDueNudges(now: Date = new Date()): Promise<NudgeSweepResult> {
    const candidates = await this.organizationModel
      .find(
        {
          enabledModules: 'website',
          activationNudgeSentAt: { $exists: false },
          createdAt: {
            $gte: new Date(now.getTime() - NUDGE_MAX_AGE_DAYS * DAY_MS),
            $lte: new Date(now.getTime() - NUDGE_MIN_AGE_DAYS * DAY_MS),
          },
        },
        { name: 1 },
      )
      .lean<{ _id: Types.ObjectId; name: string }[]>()
      .exec();

    let sent = 0;
    for (const organization of candidates) {
      try {
        if (await this.sendIfStillEmpty(organization, now)) sent += 1;
      } catch (error) {
        this.logger.error(
          `Activation nudge failed for organization ${organization._id.toString()}`,
          error,
        );
      }
    }
    return { candidates: candidates.length, sent };
  }

  private async sendIfStillEmpty(
    organization: { _id: Types.ObjectId; name: string },
    now: Date,
  ): Promise<boolean> {
    const online = await this.offerModel
      .exists({ organizationId: organization._id, status: 'active' })
      .exec();
    if (online) return false;

    const owner = await this.ownerEmail(organization._id);
    if (!owner) return false;

    const claimed = await this.organizationModel
      .updateOne(
        { _id: organization._id, activationNudgeSentAt: { $exists: false } },
        { $set: { activationNudgeSentAt: now } },
      )
      .exec();
    if (claimed.modifiedCount === 0) return false;

    const appUrl =
      this.configService.get<string>('APP_URL') ?? 'http://localhost:3000';
    const result = await this.emailProvider.send({
      to: owner,
      subject: SUBJECT,
      body: interpolate(
        BODY_TEMPLATE,
        {
          organizationName: organization.name,
          catalogUrl: `${appUrl}/dashboard/catalog`,
        },
        { escapeHtml: true },
      ),
    });
    return result.status === 'sent';
  }

  /** The organization's first active member — the person who created it. */
  private async ownerEmail(
    organizationId: Types.ObjectId,
  ): Promise<string | null> {
    const membership = await this.membershipModel
      .findOne({ organizationId, status: 'active' })
      .sort({ createdAt: 1 })
      .lean<{ userId: Types.ObjectId }>()
      .exec();
    if (!membership) return null;
    const user = await this.userModel
      .findById(membership.userId, { email: 1 })
      .lean<{ email: string }>()
      .exec();
    return user?.email ?? null;
  }
}
