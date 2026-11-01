import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PasswordResetService } from '../identity/auth/password-reset.service';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { backgroundWorkersDisabled } from '../core/background/background-workers';
import { readKorvaAiConfig } from '../ai/korva-ai.config';

/** Every background queue the API runs, with what it does — for the Système page. */
export const PLATFORM_QUEUES: { name: string; label: string }[] = [
  { name: 'events', label: 'Événements et automatisations' },
  { name: 'booking-reminder', label: 'Rappels de rendez-vous' },
  { name: 'webhook-deliveries', label: 'Webhooks sortants' },
  { name: 'campaign-sends', label: 'Envoi des campagnes' },
  { name: 'abandoned-cart-reminder', label: 'Relance des paniers abandonnés' },
  { name: 'customer-inactivity', label: 'Clients inactifs' },
  { name: 'invoice-overdue', label: 'Factures en retard' },
  { name: 'quote-expiry', label: 'Devis expirés' },
  { name: 'recurring-billing', label: 'Facturation récurrente' },
  { name: 'payment-reconciliation', label: 'Rapprochement des paiements' },
  { name: 'subscription-period', label: 'Renouvellement des abonnements' },
  { name: 'subscription-auto-charge', label: 'Prélèvement des abonnements' },
  { name: 'calendar-sync', label: 'Synchronisation des agendas' },
  { name: 'activation-nudge', label: 'Relance « site vide »' },
];

/** The free Atlas tier's storage cap — what the database figure is compared with. */
const ATLAS_M0_BYTES = 512 * 1024 * 1024;
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { Organization } from '../organizations/schemas/organization.schema';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionBillingService } from '../subscription-billing/subscription-billing.service';
import { AuditService } from '../audit/audit.service';
import {
  BUSINESS_MODEL_DEFINITIONS,
  type BusinessModel,
  type KorvaAiSystemStatus,
  type PrimaryChannel,
} from '@korva/types';
import {
  ActivationReportService,
  type ActivationRow,
} from '../activation/activation-report.service';

/** The collection holding each sales channel's records — what "activity" means per trade. */
const CHANNEL_COLLECTION: Record<PrimaryChannel, string> = {
  orders: 'orders',
  bookings: 'bookings',
  quotes: 'quotes',
  leads: 'leads',
};
const CHANNELS = Object.keys(CHANNEL_COLLECTION) as PrimaryChannel[];

export type ChannelCounts = Record<PrimaryChannel, number>;

export interface BusinessRow extends ActivationRow {
  planKey: string | null;
  /** Records in the trade's own main channel over 30 days (orders for a shop, bookings for a
   *  salon, quotes for a service business, leads for an agency). */
  activity30d: number;
  channel: PrimaryChannel | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface PlanRow {
  _id: Types.ObjectId;
  key: string;
  name: string;
  priceAmount: number;
  priceCurrency: string;
}

interface SubscriptionRow {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  planId: Types.ObjectId;
  status: string;
  currentPeriodEnd: Date;
  cancelAtPeriodEnd?: boolean;
  trialPlanKey?: string | null;
  trialEndsAt?: Date | null;
}

interface MembershipRow {
  userId: Types.ObjectId;
  status: string;
}

interface UserRow {
  _id: Types.ObjectId;
  email: string;
  firstName?: string;
  lastName?: string;
}

interface InvoiceRow {
  _id: Types.ObjectId;
  number: string;
  amount: number;
  currency: string;
  status: string;
  periodStart: Date;
  periodEnd: Date;
  dueAt: Date;
  paidAt?: Date | null;
}

export type SubscriptionFilter =
  'all' | 'paid' | 'trial' | 'past_due' | 'canceling';

/**
 * The figures and actions of KORVA's own administration (see PlatformAdminGuard for who gets in).
 *
 * Reads across every organization, so it queries the collections directly instead of going
 * through the tenant-scoped repositories, which all require an organizationId. The three actions
 * reuse the services that own them — SubscriptionsService.changePlan / extendTrial and
 * SubscriptionBillingService.settleAsPaid — so an administrator's change follows exactly the
 * rules an owner's would, and lands in the same audit log.
 */
/** One definition of "a site online" for every figure: website module on, at least one offer
 *  published, and not suspended by the administration. */
function isSiteOnline(row: ActivationRow): boolean {
  return row.websiteEnabled && row.activeOffers > 0 && !row.suspendedAt;
}

/** Escapes a search string for use inside a RegExp. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** How long an administration view of a business dashboard lasts. */
const VIEW_AS_TTL_SECONDS = 30 * 60;

@Injectable()
export class PlatformAdminService {
  private readonly logger = new Logger(PlatformAdminService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly subscriptionBillingService: SubscriptionBillingService,
    private readonly auditService: AuditService,
    private readonly activationReport: ActivationReportService,
    private readonly passwordResetService: PasswordResetService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * "Voir son tableau de bord": a 30-minute token, in the name of the organization's owner, that
   * can only READ that one organization (JwtAuthGuard, TenantGuard). No refresh token exists for
   * it, so the view ends on its own. Recorded in the organization's journal with the
   * administrator's id.
   */
  async viewAs(organizationId: string, adminUserId: string) {
    const organization = await this.findOrganizationOrFail(organizationId);
    if (organization.suspendedAt) {
      throw new BadRequestException({
        code: 'ORGANIZATION_SUSPENDED',
        message: 'Reactivate the organization before opening its dashboard',
      });
    }
    const ownerRoles = await this.collection('roles')
      .find({ systemKey: 'OWNER' }, { projection: { _id: 1 } })
      .toArray();
    const membership = await this.collection('memberships').findOne(
      {
        organizationId: organization._id,
        status: 'active',
        roleId: { $in: ownerRoles.map((role) => role._id) },
      },
      { sort: { createdAt: 1 } },
    );
    const owner = membership
      ? await this.collection('users').findOne(
          { _id: membership.userId as Types.ObjectId },
          { projection: { email: 1, firstName: 1, lastName: 1 } },
        )
      : null;
    if (!owner) {
      throw new BadRequestException({
        code: 'OWNER_NOT_FOUND',
        message: 'This organization has no active owner to view as',
      });
    }
    const expiresInSeconds = VIEW_AS_TTL_SECONDS;
    const accessToken = this.jwtService.sign(
      {
        sub: owner._id.toString(),
        email: owner.email as string,
        view: { by: adminUserId, org: organizationId },
      },
      {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
        expiresIn: expiresInSeconds,
      },
    );
    await this.auditService.record({
      organizationId,
      userId: adminUserId,
      action: 'LOGIN',
      entity: 'organization',
      entityId: organizationId,
      metadata: { viewAs: true, readOnly: true, by: 'platform_admin' },
    });
    return {
      accessToken,
      organizationId,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString(),
      user: {
        id: owner._id.toString(),
        email: owner.email as string,
        firstName: owner.firstName as string | undefined,
        lastName: owner.lastName as string | undefined,
      },
    };
  }

  /** The plan catalog as the billing engine sees it: every tier in every currency. */
  async plans() {
    const plans = (await this.collection('plans')
      .find(
        {},
        {
          projection: {
            key: 1,
            name: 1,
            priceAmount: 1,
            priceCurrency: 1,
            modules: 1,
            limits: 1,
          },
        },
      )
      .sort({ priceCurrency: 1, priceAmount: 1 })
      .toArray()) as unknown as {
      key: string;
      name: string;
      priceAmount: number;
      priceCurrency: string;
      modules: string[];
      limits?: Record<string, number>;
    }[];
    const counts = await this.collection('subscriptions')
      .aggregate<{ _id: Types.ObjectId; count: number }>([
        { $match: { status: { $ne: 'canceled' } } },
        { $group: { _id: '$planId', count: { $sum: 1 } } },
      ])
      .toArray();
    const byPlan = new Map(
      counts.map((row) => [row._id.toString(), row.count]),
    );
    return plans.map((plan) => ({
      key: plan.key,
      name: plan.name,
      priceAmount: plan.priceAmount,
      priceCurrency: plan.priceCurrency,
      modules: plan.modules,
      limits: plan.limits ?? {},
      subscribers:
        byPlan.get(
          (plan as unknown as { _id: Types.ObjectId })._id.toString(),
        ) ?? 0,
    }));
  }

  /** The audit trail of the whole platform, newest first, optionally for one organization. */
  async audit(options: { organizationId?: string; page?: number }) {
    const page = Math.max(1, options.page ?? 1);
    const limit = 50;
    const filter =
      options.organizationId && Types.ObjectId.isValid(options.organizationId)
        ? { organizationId: new Types.ObjectId(options.organizationId) }
        : {};
    const [rows, total] = await Promise.all([
      this.collection('audit_logs')
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray()
        .then(
          (docs) =>
            docs as unknown as {
              _id: Types.ObjectId;
              organizationId: Types.ObjectId;
              userId?: Types.ObjectId;
              action: string;
              entity: string;
              entityId?: string;
              metadata?: Record<string, unknown>;
              createdAt: Date;
            }[],
        ),
      this.collection('audit_logs').countDocuments(filter),
    ]);
    const [organizations, users] = await Promise.all([
      this.organizationModel
        .find(
          { _id: { $in: rows.map((row) => row.organizationId) } },
          { name: 1 },
        )
        .lean<{ _id: Types.ObjectId; name: string }[]>()
        .exec(),
      this.collection('users')
        .find(
          {
            _id: {
              $in: rows
                .map((row) => row.userId)
                .filter((id): id is Types.ObjectId => Boolean(id)),
            },
          },
          { projection: { email: 1 } },
        )
        .toArray()
        .then(
          (docs) => docs as unknown as { _id: Types.ObjectId; email: string }[],
        ),
    ]);
    const orgName = new Map(
      organizations.map((org) => [org._id.toString(), org.name]),
    );
    const userEmail = new Map(
      users.map((user) => [user._id.toString(), user.email]),
    );
    return {
      data: rows.map((row) => ({
        id: row._id.toString(),
        organizationId: row.organizationId.toString(),
        organizationName: orgName.get(row.organizationId.toString()) ?? '—',
        userEmail: row.userId
          ? (userEmail.get(row.userId.toString()) ?? null)
          : null,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId ?? null,
        metadata: row.metadata ?? {},
        createdAt: row.createdAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /**
   * The technical state of the platform, from the API's own point of view: background queues
   * (failed jobs are the first sign of trouble), database size against the free Atlas tier's
   * cap, and whether email and payment collection are really configured.
   */
  async system() {
    const stats = (await this.connection.db!.stats()) as {
      dataSize: number;
      storageSize: number;
      indexSize: number;
      collections: number;
    };
    const emailConfigured =
      this.configService.get<string>('EMAIL_PROVIDER') === 'resend' &&
      Boolean(this.configService.get<string>('RESEND_API_KEY'));
    const platformPaymentAccounts = await this.collection(
      'integration_accounts',
    ).countDocuments({
      scope: 'platform',
      domain: 'payment',
      status: { $ne: 'revoked' },
    });

    return {
      api: {
        uptimeSeconds: Math.round(process.uptime()),
        nodeVersion: process.version,
        environment:
          this.configService.get<string>('NODE_ENV') ?? 'development',
      },
      database: {
        dataBytes: stats.dataSize,
        storageBytes: stats.storageSize,
        indexBytes: stats.indexSize,
        collections: stats.collections,
        freeTierCapBytes: ATLAS_M0_BYTES,
      },
      email: {
        configured: emailConfigured,
        provider: emailConfigured ? 'resend' : 'aucun (journalisé seulement)',
        from: this.configService.get<string>('EMAIL_FROM') ?? null,
      },
      payments: { platformAccounts: platformPaymentAccounts },
      ai: await this.aiStatus(),
      administrators: (
        this.configService.get<string>('PLATFORM_ADMIN_EMAILS') ?? ''
      )
        .split(',')
        .filter((email) => email.trim()).length,
      queues: await this.queueCounts(),
    };
  }

  /**
   * KORVA IA from the platform's side: which brain is configured (never the key), and what it has
   * cost this month against AI_MONTHLY_BUDGET_USD. Read from ai_usage_logs directly, like the rest
   * of this page, so the administration does not depend on the AI module.
   */
  private async aiStatus(): Promise<KorvaAiSystemStatus> {
    const config = readKorvaAiConfig(this.configService);
    const start = new Date(
      `${new Date().toISOString().slice(0, 7)}-01T00:00:00.000Z`,
    );
    const logs = this.collection('ai_usage_logs');
    const [[totals], top] = await Promise.all([
      logs
        .aggregate<{ costUsd: number; calls: number; unpricedCalls: number }>([
          { $match: { createdAt: { $gte: start } } },
          {
            $group: {
              _id: null,
              costUsd: { $sum: { $ifNull: ['$costUsd', 0] } },
              calls: { $sum: 1 },
              unpricedCalls: {
                $sum: { $cond: [{ $eq: ['$costUsd', null] }, 1, 0] },
              },
            },
          },
        ])
        .toArray(),
      logs
        .aggregate<{ _id: Types.ObjectId; costUsd: number; calls: number }>([
          { $match: { createdAt: { $gte: start } } },
          {
            $group: {
              _id: '$organizationId',
              costUsd: { $sum: { $ifNull: ['$costUsd', 0] } },
              calls: { $sum: 1 },
            },
          },
          { $sort: { costUsd: -1, calls: -1 } },
          { $limit: 5 },
        ])
        .toArray(),
    ]);
    const since = new Date(Date.now() - 29 * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    const period = start.toISOString().slice(0, 7);
    const [dailyRows, [messages]] = await Promise.all([
      logs
        .aggregate<{
          _id: string;
          calls: number;
          costUsd: number;
          organizations: unknown[];
        }>([
          { $match: { createdAt: { $gte: since } } },
          {
            $group: {
              _id: {
                $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
              },
              calls: { $sum: 1 },
              costUsd: { $sum: { $ifNull: ['$costUsd', 0] } },
              organizations: { $addToSet: '$organizationId' },
            },
          },
        ])
        .toArray(),
      this.collection('usage')
        .aggregate<{ messages: number; organizations: number }>([
          {
            $match: {
              metric: 'ai_messages_per_month',
              period,
              count: { $gt: 0 },
            },
          },
          {
            $group: {
              _id: null,
              messages: { $sum: '$count' },
              organizations: { $sum: 1 },
            },
          },
        ])
        .toArray(),
    ]);
    const byDay = new Map(dailyRows.map((row) => [row._id, row]));
    const daily = Array.from({ length: 30 }, (_, index) => {
      const day = new Date(since.getTime() + index * 86_400_000)
        .toISOString()
        .slice(0, 10);
      const row = byDay.get(day);
      return {
        day,
        calls: row?.calls ?? 0,
        costUsd: row?.costUsd ?? 0,
        organizations: row?.organizations.length ?? 0,
      };
    });
    const names = new Map(
      (
        await this.organizationModel
          .find({ _id: { $in: top.map((row) => row._id) } }, { name: 1 })
          .lean()
          .exec()
      ).map((org) => [String(org._id), org.name]),
    );
    return {
      configured: config.provider !== 'none',
      provider: config.provider === 'none' ? 'aucun' : config.label,
      model: config.provider === 'none' ? null : config.model,
      reason: config.provider === 'none' ? config.reason : null,
      monthlyBudgetUsd: config.monthlyBudgetUsd,
      spentThisMonthUsd: totals?.costUsd ?? 0,
      callsThisMonth: totals?.calls ?? 0,
      unpricedCalls: totals?.unpricedCalls ?? 0,
      topOrganizations: top.map((row) => ({
        organizationId: String(row._id),
        name: names.get(String(row._id)) ?? '—',
        costUsd: row.costUsd,
        calls: row.calls,
      })),
      messagesThisMonth: messages?.messages ?? 0,
      activeOrganizationsThisMonth: messages?.organizations ?? 0,
      daily,
    };
  }

  private async queueCounts() {
    const redisUrl = this.configService.get<string>('REDIS_URL');
    if (!redisUrl || backgroundWorkersDisabled(this.configService)) return null;
    const connection = new IORedis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
    try {
      await connection.connect();
      return await Promise.all(
        PLATFORM_QUEUES.map(async ({ name, label }) => {
          const queue = new Queue(name, { connection });
          try {
            const counts = await queue.getJobCounts(
              'waiting',
              'active',
              'delayed',
              'failed',
            );
            return { name, label, ...counts };
          } finally {
            await queue.close();
          }
        }),
      );
    } catch (error) {
      this.logger.warn(`Queue counts unavailable: ${String(error)}`);
      return null;
    } finally {
      connection.disconnect();
    }
  }

  /** Per organization, how many records each channel received since `since`. */
  private async channelCounts(
    organizationIds: Types.ObjectId[],
    since: Date,
  ): Promise<Map<string, ChannelCounts>> {
    const result = new Map<string, ChannelCounts>();
    const perChannel = await Promise.all(
      CHANNELS.map((channel) =>
        this.collection(CHANNEL_COLLECTION[channel])
          .aggregate<{ _id: Types.ObjectId; count: number }>([
            {
              $match: {
                organizationId: { $in: organizationIds },
                createdAt: { $gte: since },
              },
            },
            { $group: { _id: '$organizationId', count: { $sum: 1 } } },
          ])
          .toArray(),
      ),
    );
    CHANNELS.forEach((channel, index) => {
      for (const row of perChannel[index]!) {
        const key = row._id.toString();
        const counts = result.get(key) ?? {
          orders: 0,
          bookings: 0,
          quotes: 0,
          leads: 0,
        };
        counts[channel] = row.count;
        result.set(key, counts);
      }
    });
    return result;
  }

  /** The billed plan key of each organization. */
  private async planKeysByOrganization(): Promise<Map<string, string>> {
    const plans = await this.plansById();
    const subscriptions = (await this.collection('subscriptions')
      .find({}, { projection: { organizationId: 1, planId: 1 } })
      .toArray()) as unknown as {
      organizationId: Types.ObjectId;
      planId: Types.ObjectId;
    }[];
    return new Map(
      subscriptions.map((row) => [
        row.organizationId.toString(),
        plans.get(row.planId.toString())?.key ?? 'inconnu',
      ]),
    );
  }

  /**
   * Every business on the platform, whatever its trade: what it needs (ActivationReportService),
   * its plan, and its activity in its OWN channel — a salon is judged on bookings, an agency on
   * leads, not everyone on shop orders.
   */
  async businesses(now: Date = new Date()): Promise<BusinessRow[]> {
    const rows = await this.activationReport.report(now);
    const ids = rows.map((row) => new Types.ObjectId(row.id));
    const [counts, plans] = await Promise.all([
      this.channelCounts(ids, new Date(now.getTime() - 30 * DAY_MS)),
      this.planKeysByOrganization(),
    ]);
    return rows.map((row) => {
      const channel = row.businessModel
        ? BUSINESS_MODEL_DEFINITIONS[row.businessModel as BusinessModel]
            .primaryChannel
        : null;
      const orgCounts = counts.get(row.id);
      const activity30d = orgCounts
        ? channel
          ? orgCounts[channel]
          : CHANNELS.reduce((sum, key) => sum + orgCounts[key], 0)
        : 0;
      return {
        ...row,
        planKey: plans.get(row.id) ?? null,
        activity30d,
        channel,
      };
    });
  }

  /** One line per type of activity: how many businesses, how many live, how busy. */
  async byBusinessModel(now: Date = new Date()) {
    const rows = await this.businesses(now);
    const groups = new Map<
      string,
      {
        organizations: number;
        sitesOnline: number;
        activity30d: number;
        channel: PrimaryChannel | null;
      }
    >();
    for (const row of rows) {
      const key = row.businessModel ?? 'none';
      const group = groups.get(key) ?? {
        organizations: 0,
        sitesOnline: 0,
        activity30d: 0,
        channel: row.channel,
      };
      group.organizations += 1;
      if (isSiteOnline(row)) group.sitesOnline += 1;
      group.activity30d += row.activity30d;
      groups.set(key, group);
    }
    return [...groups.entries()]
      .map(([businessModel, group]) => ({ businessModel, ...group }))
      .sort((a, b) => b.organizations - a.organizations);
  }

  private collection(name: string) {
    return this.connection.collection(name);
  }

  private async plansById(): Promise<Map<string, PlanRow>> {
    const plans = await this.collection('plans')
      .find(
        {},
        { projection: { key: 1, name: 1, priceAmount: 1, priceCurrency: 1 } },
      )
      .toArray();
    return new Map(
      plans.map((plan) => [plan._id.toString(), plan as unknown as PlanRow]),
    );
  }

  async overview(now: Date = new Date()) {
    const since = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const [organizations, new7, new30, offersOnline, orders30, bookings30] =
      await Promise.all([
        this.organizationModel.countDocuments().exec(),
        this.organizationModel
          .countDocuments({ createdAt: { $gte: since(7) } })
          .exec(),
        this.organizationModel
          .countDocuments({ createdAt: { $gte: since(30) } })
          .exec(),
        this.collection('offers').countDocuments({ status: 'active' }),
        this.collection('orders').countDocuments({
          createdAt: { $gte: since(30) },
        }),
        this.collection('bookings').countDocuments({
          createdAt: { $gte: since(30) },
        }),
      ]);

    const plans = await this.plansById();
    // Only subscriptions of organizations that still exist: an orphan row (its organization
    // deleted) would otherwise count towards a plan and the expected revenue.
    const existingIds = await this.organizationModel.distinct('_id').exec();
    const subscriptions = (await this.collection('subscriptions')
      .find(
        { organizationId: { $in: existingIds } },
        {
          projection: { planId: 1, status: 1, trialEndsAt: 1, trialPlanKey: 1 },
        },
      )
      .toArray()) as unknown as SubscriptionRow[];

    const byPlan: Record<string, number> = {};
    const revenueByCurrency: Record<string, number> = {};
    let trialsRunning = 0;
    let pastDue = 0;
    for (const subscription of subscriptions) {
      const plan = plans.get(subscription.planId.toString());
      if (subscription.status === 'past_due') pastDue += 1;
      if (subscription.trialEndsAt && subscription.trialEndsAt > now)
        trialsRunning += 1;
      if (!plan || subscription.status === 'canceled') continue;
      byPlan[plan.key] = (byPlan[plan.key] ?? 0) + 1;
      if (plan.priceAmount > 0 && subscription.status === 'active') {
        revenueByCurrency[plan.priceCurrency] =
          (revenueByCurrency[plan.priceCurrency] ?? 0) + plan.priceAmount;
      }
    }

    const byBusinessModel = await this.byBusinessModel(now);
    const sitesOnline = byBusinessModel.reduce(
      (sum, group) => sum + group.sitesOnline,
      0,
    );

    return {
      byBusinessModel,
      organizations,
      newLast7Days: new7,
      newLast30Days: new30,
      sitesOnline,
      offersOnline,
      ordersLast30Days: orders30,
      bookingsLast30Days: bookings30,
      trialsRunning,
      pastDue,
      organizationsByPlan: byPlan,
      monthlyRevenueByCurrency: revenueByCurrency,
    };
  }

  async subscriptions(
    filter: SubscriptionFilter = 'all',
    now: Date = new Date(),
  ) {
    const plans = await this.plansById();
    const existingIds = await this.organizationModel.distinct('_id').exec();
    const rows = (await this.collection('subscriptions')
      .find({ organizationId: { $in: existingIds } })
      .sort({ updatedAt: -1 })
      .limit(500)
      .toArray()) as unknown as SubscriptionRow[];
    const organizations = await this.organizationModel
      .find(
        { _id: { $in: rows.map((row) => row.organizationId) } },
        { name: 1, slug: 1 },
      )
      .lean<{ _id: Types.ObjectId; name: string; slug: string }[]>()
      .exec();
    const orgById = new Map(
      organizations.map((org) => [org._id.toString(), org]),
    );

    return rows
      .map((row) => {
        const plan = plans.get(row.planId.toString());
        const org = orgById.get(row.organizationId.toString());
        const trialRunning = Boolean(row.trialEndsAt && row.trialEndsAt > now);
        return {
          organizationId: row.organizationId.toString(),
          organizationName: org?.name ?? '—',
          slug: org?.slug ?? '',
          planKey: plan?.key ?? 'inconnu',
          planName: plan?.name ?? '—',
          priceAmount: plan?.priceAmount ?? 0,
          priceCurrency: plan?.priceCurrency ?? '',
          status: row.status,
          currentPeriodEnd: row.currentPeriodEnd,
          cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
          trialPlanKey: trialRunning ? (row.trialPlanKey ?? null) : null,
          trialEndsAt: trialRunning ? row.trialEndsAt : null,
        };
      })
      .filter((row) => {
        switch (filter) {
          case 'paid':
            return row.priceAmount > 0 && row.status !== 'canceled';
          case 'trial':
            return row.trialEndsAt !== null;
          case 'past_due':
            return row.status === 'past_due';
          case 'canceling':
            return row.cancelAtPeriodEnd;
          default:
            return true;
        }
      });
  }

  async organization(organizationId: string) {
    if (!Types.ObjectId.isValid(organizationId)) this.notFound();
    const id = new Types.ObjectId(organizationId);
    const organization = await this.organizationModel
      .findById(id)
      .lean<Record<string, unknown> & { _id: Types.ObjectId }>()
      .exec();
    if (!organization) this.notFound();

    const [
      subscription,
      invoices,
      memberships,
      offersOnline,
      offersTotal,
      orders,
      bookings,
      audit,
      quotes,
      leads,
      contacts,
      invoicesIssued,
    ] = await Promise.all([
      this.collection('subscriptions')
        .findOne({ organizationId: id })
        .then((row) => row as unknown as SubscriptionRow | null),
      this.collection('subscription_invoices')
        .find({ organizationId: id })
        .sort({ periodStart: -1 })
        .limit(12)
        .toArray()
        .then((rows) => rows as unknown as InvoiceRow[]),
      this.collection('memberships')
        .find(
          { organizationId: id },
          { projection: { userId: 1, status: 1, createdAt: 1 } },
        )
        .sort({ createdAt: 1 })
        .toArray()
        .then((rows) => rows as unknown as MembershipRow[]),
      this.collection('offers').countDocuments({
        organizationId: id,
        status: 'active',
      }),
      this.collection('offers').countDocuments({ organizationId: id }),
      this.collection('orders').countDocuments({ organizationId: id }),
      this.collection('bookings').countDocuments({ organizationId: id }),
      this.auditService.listRecent(organizationId, 20),
      this.collection('quotes').countDocuments({ organizationId: id }),
      this.collection('leads').countDocuments({ organizationId: id }),
      this.collection('contacts').countDocuments({ organizationId: id }),
      this.collection('invoices').countDocuments({ organizationId: id }),
    ]);
    const users = await this.collection('users')
      .find(
        { _id: { $in: memberships.map((m) => m.userId) } },
        { projection: { email: 1, firstName: 1, lastName: 1 } },
      )
      .toArray()
      .then((rows) => rows as unknown as UserRow[]);
    const userById = new Map(users.map((user) => [user._id.toString(), user]));
    const plans = await this.plansById();
    const plan = subscription
      ? plans.get(subscription.planId.toString())
      : undefined;

    return {
      id: organizationId,
      name: organization.name,
      slug: organization.slug,
      type: organization.type,
      businessModel: organization.businessModel,
      country: organization.country,
      currency: organization.currency,
      createdAt: organization.createdAt,
      logo: organization.logo,
      whatsappNumber: organization.whatsappNumber,
      contactPhone: organization.contactPhone,
      enabledModules: organization.enabledModules,
      activationNudgeSentAt: organization.activationNudgeSentAt ?? null,
      suspendedAt: organization.suspendedAt ?? null,
      suspensionReason: organization.suspensionReason ?? null,
      counts: {
        offersOnline,
        offersTotal,
        orders,
        bookings,
        quotes,
        leads,
        contacts,
        invoices: invoicesIssued,
      },
      members: memberships.map((membership) => {
        const user = userById.get(membership.userId.toString());
        return {
          email: user?.email ?? '—',
          name:
            [user?.firstName, user?.lastName].filter(Boolean).join(' ') || null,
          status: membership.status,
        };
      }),
      subscription: subscription
        ? {
            planKey: plan?.key ?? null,
            planName: plan?.name ?? null,
            priceAmount: plan?.priceAmount ?? 0,
            priceCurrency: plan?.priceCurrency ?? null,
            status: subscription.status,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: Boolean(subscription.cancelAtPeriodEnd),
            trialPlanKey: subscription.trialPlanKey ?? null,
            trialEndsAt: subscription.trialEndsAt ?? null,
          }
        : null,
      invoices: invoices.map((invoice) => ({
        id: invoice._id.toString(),
        number: invoice.number,
        amount: invoice.amount,
        currency: invoice.currency,
        status: invoice.status,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        dueAt: invoice.dueAt,
        paidAt: invoice.paidAt ?? null,
      })),
      recentActivity: audit,
    };
  }

  assignPlan(organizationId: string, adminUserId: string, planKey: string) {
    return this.subscriptionsService.changePlan(
      organizationId,
      adminUserId,
      planKey,
      {
        manualPayment: true,
      },
    );
  }

  extendTrial(organizationId: string, adminUserId: string, days: number) {
    return this.subscriptionsService.extendTrial(
      organizationId,
      adminUserId,
      days,
    );
  }

  /** A subscription invoice KORVA was paid for outside the platform (Mobile Money, cash…). */
  async markInvoicePaid(
    organizationId: string,
    invoiceId: string,
    adminUserId: string,
  ) {
    if (!Types.ObjectId.isValid(invoiceId)) this.notFound();
    const invoice = (await this.collection('subscription_invoices').findOne({
      _id: new Types.ObjectId(invoiceId),
      organizationId: new Types.ObjectId(organizationId),
    })) as unknown as InvoiceRow | null;
    if (!invoice) this.notFound();
    const settled = await this.subscriptionBillingService.settleAsPaid(
      organizationId,
      invoiceId,
      invoice.number,
      { collection: 'manual', by: 'platform_admin', adminUserId },
    );
    return { invoiceNumber: invoice.number, settled };
  }

  /**
   * Suspends an organization: its members can no longer work in it (TenantGuard), its API keys
   * stop (ApiKeyGuard) and its public site goes offline (PublicService). Reversible, and no data
   * is touched — reactivate() restores everything as it was.
   */
  async suspend(organizationId: string, adminUserId: string, reason: string) {
    const organization = await this.findOrganizationOrFail(organizationId);
    organization.suspendedAt = new Date();
    organization.suspensionReason = reason;
    await organization.save();
    await this.auditService.record({
      organizationId,
      userId: adminUserId,
      action: 'SETTINGS_CHANGE',
      entity: 'organization',
      entityId: organizationId,
      metadata: { suspended: true, reason, by: 'platform_admin' },
    });
    return { suspendedAt: organization.suspendedAt };
  }

  async reactivate(organizationId: string, adminUserId: string) {
    const organization = await this.findOrganizationOrFail(organizationId);
    organization.suspendedAt = undefined;
    organization.suspensionReason = undefined;
    await organization.save();
    await this.auditService.record({
      organizationId,
      userId: adminUserId,
      action: 'SETTINGS_CHANGE',
      entity: 'organization',
      entityId: organizationId,
      metadata: { suspended: false, by: 'platform_admin' },
    });
    return { suspendedAt: null };
  }

  /**
   * Every account on the platform — owners, staff, administrators — searchable by email or name,
   * with the organizations each belongs to and the last time it used the dashboard.
   */
  async users(search?: string) {
    const q = search?.trim();
    const filter = q
      ? {
          $or: ['email', 'firstName', 'lastName'].map((field) => ({
            [field]: { $regex: escapeRegex(q), $options: 'i' },
          })),
        }
      : {};
    const users = (await this.collection('users')
      .find(filter, {
        projection: {
          email: 1,
          firstName: 1,
          lastName: 1,
          createdAt: 1,
          emailVerifiedAt: 1,
          totpEnabled: 1,
          disabledAt: 1,
        },
      })
      .sort({ createdAt: -1 })
      .limit(300)
      .toArray()) as unknown as {
      _id: Types.ObjectId;
      email: string;
      firstName?: string;
      lastName?: string;
      createdAt: Date;
      emailVerifiedAt?: Date | null;
      totpEnabled?: boolean;
      disabledAt?: Date | null;
    }[];
    const ids = users.map((user) => user._id);
    const [memberships, activity] = await Promise.all([
      this.collection('memberships')
        .find(
          { userId: { $in: ids } },
          { projection: { userId: 1, organizationId: 1, status: 1 } },
        )
        .toArray()
        .then(
          (rows) =>
            rows as unknown as {
              userId: Types.ObjectId;
              organizationId: Types.ObjectId;
              status: string;
            }[],
        ),
      this.collection('sessions')
        .aggregate<{ _id: Types.ObjectId; last: Date }>([
          { $match: { userId: { $in: ids } } },
          { $group: { _id: '$userId', last: { $max: '$updatedAt' } } },
        ])
        .toArray(),
    ]);
    const organizations = await this.organizationModel
      .find(
        { _id: { $in: memberships.map((m) => m.organizationId) } },
        { name: 1 },
      )
      .lean<{ _id: Types.ObjectId; name: string }[]>()
      .exec();
    const orgName = new Map(
      organizations.map((org) => [org._id.toString(), org.name]),
    );
    const lastByUser = new Map(
      activity.map((row) => [row._id.toString(), row.last]),
    );

    return users.map((user) => ({
      id: user._id.toString(),
      email: user.email,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
      createdAt: user.createdAt,
      emailVerified: Boolean(user.emailVerifiedAt),
      twoFactor: Boolean(user.totpEnabled),
      disabledAt: user.disabledAt ?? null,
      lastActivityAt: lastByUser.get(user._id.toString()) ?? null,
      organizations: memberships
        .filter((m) => m.userId.equals(user._id))
        .map((m) => ({
          id: m.organizationId.toString(),
          name: orgName.get(m.organizationId.toString()) ?? '—',
          status: m.status,
        })),
    }));
  }

  /**
   * Disables an account: no sign-in, no session refresh, and every open session revoked now, so
   * the dashboard stops at the latest when its current access token expires (15 minutes).
   * Administrators are not Users (see PlatformAdmin), so this can never lock the administration out.
   */
  async disableUser(userId: string, adminUserId: string) {
    const id = this.userObjectId(userId);
    const result = await this.collection('users').updateOne(
      { _id: id },
      { $set: { disabledAt: new Date() } },
    );
    if (result.matchedCount === 0) this.notFound();
    await this.collection('sessions').updateMany(
      { userId: id, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
    await this.auditUserAction(id, adminUserId, { disabled: true });
    return { disabled: true };
  }

  async enableUser(userId: string, adminUserId: string) {
    const id = this.userObjectId(userId);
    const result = await this.collection('users').updateOne(
      { _id: id },
      { $set: { disabledAt: null } },
    );
    if (result.matchedCount === 0) this.notFound();
    await this.auditUserAction(id, adminUserId, { disabled: false });
    return { disabled: false };
  }

  /** Sends the usual "reset your password" email — the administrator never sees the link. */
  async sendPasswordReset(userId: string, adminUserId: string) {
    const id = this.userObjectId(userId);
    const user = (await this.collection('users').findOne(
      { _id: id },
      { projection: { email: 1 } },
    )) as {
      email: string;
    } | null;
    if (!user) this.notFound();
    await this.passwordResetService.forgotPassword(user.email);
    await this.auditUserAction(id, adminUserId, { passwordResetSent: true });
    return { sent: true };
  }

  /** The audit log is per organization: one line in each organization the user belongs to. */
  private async auditUserAction(
    userId: Types.ObjectId,
    adminUserId: string,
    metadata: Record<string, unknown>,
  ) {
    const memberships = (await this.collection('memberships')
      .find({ userId }, { projection: { organizationId: 1 } })
      .toArray()) as unknown as { organizationId: Types.ObjectId }[];
    if (memberships.length === 0) {
      this.logger.log(
        `Platform admin ${adminUserId} on user ${userId.toString()}: ${JSON.stringify(metadata)}`,
      );
    }
    for (const membership of memberships) {
      await this.auditService.record({
        organizationId: membership.organizationId.toString(),
        userId: adminUserId,
        action: 'SETTINGS_CHANGE',
        entity: 'membership',
        entityId: userId.toString(),
        metadata: { ...metadata, by: 'platform_admin' },
      });
    }
  }

  private userObjectId(userId: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(userId)) this.notFound();
    return new Types.ObjectId(userId);
  }

  private async findOrganizationOrFail(organizationId: string) {
    if (!Types.ObjectId.isValid(organizationId)) this.notFound();
    const organization = await this.organizationModel
      .findById(organizationId)
      .exec();
    if (!organization) this.notFound();
    return organization;
  }

  private notFound(): never {
    throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
  }
}
