import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { Organization } from '../organizations/schemas/organization.schema';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { SubscriptionBillingService } from '../subscription-billing/subscription-billing.service';
import { AuditService } from '../audit/audit.service';

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
@Injectable()
export class PlatformAdminService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly subscriptionBillingService: SubscriptionBillingService,
    private readonly auditService: AuditService,
  ) {}

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
    const [
      organizations,
      new7,
      new30,
      sitesOnline,
      offersOnline,
      orders30,
      bookings30,
    ] = await Promise.all([
      this.organizationModel.countDocuments().exec(),
      this.organizationModel
        .countDocuments({ createdAt: { $gte: since(7) } })
        .exec(),
      this.organizationModel
        .countDocuments({ createdAt: { $gte: since(30) } })
        .exec(),
      this.collection('offers')
        .distinct('organizationId', { status: 'active' })
        .then((ids) => ids.length),
      this.collection('offers').countDocuments({ status: 'active' }),
      this.collection('orders').countDocuments({
        createdAt: { $gte: since(30) },
      }),
      this.collection('bookings').countDocuments({
        createdAt: { $gte: since(30) },
      }),
    ]);

    const plans = await this.plansById();
    const subscriptions = (await this.collection('subscriptions')
      .find(
        {},
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

    return {
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
    const rows = (await this.collection('subscriptions')
      .find({})
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
      counts: { offersOnline, offersTotal, orders, bookings },
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

  private notFound(): never {
    throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
  }
}
