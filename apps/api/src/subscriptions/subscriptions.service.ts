import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { KorvaProduct } from '@korva/types';
import {
  BUSINESS_MODEL_DEFINITIONS,
  KORVA_PRODUCTS,
  PRODUCT_MODULES,
  SIGNUP_TRIAL,
  isCurrencyChargeable,
  planHasFeature,
  planMeetsMinimum,
  parseChargeableCurrencies,
  resolveEffectiveModules,
} from '@korva/types';
import { PlansService } from './plans.service';
import { SubscriptionsRepository } from './subscriptions.repository';
import { SubscriptionDocument } from './schemas/subscription.schema';
import { PlanDocument } from './schemas/plan.schema';
import { AuditService } from '../audit/audit.service';
import {
  Organization,
  OrganizationDocument,
} from '../organizations/schemas/organization.schema';
import { EventBusService } from '../core/events/event-bus.service';
import { MembershipsService } from '../identity/memberships/memberships.service';
import { SubscriptionInvoicesRepository } from './subscription-invoices.repository';
import type { SubscriptionInvoiceDocument } from './schemas/subscription-invoice.schema';
import { CountersService } from '../core/counters/counters.service';

function addOneMonth(date: Date): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() + 1);
  return result;
}

/**
 * Fair-share proration for a mid-period plan change: the fraction of the CURRENT period still
 * remaining, multiplied by the price delta between the old and new plan. Positive means the new
 * plan is more expensive for the time left (amount owed), negative means a credit. Returns null
 * when there is nothing sensible to compute (no prior period, or the two plans don't share a
 * currency) — the caller stores null in that case rather than a misleading 0.
 */
function computeProration(
  oldPriceAmount: number,
  oldPriceCurrency: string,
  newPriceAmount: number,
  newPriceCurrency: string,
  currentPeriodStart: Date,
  currentPeriodEnd: Date,
  now: Date,
): number | null {
  if (oldPriceCurrency !== newPriceCurrency) return null;
  const totalMs = currentPeriodEnd.getTime() - currentPeriodStart.getTime();
  if (totalMs <= 0) return null;
  const remainingMs = Math.min(
    totalMs,
    Math.max(0, currentPeriodEnd.getTime() - now.getTime()),
  );
  const remainingFraction = remainingMs / totalMs;
  const delta = newPriceAmount - oldPriceAmount;
  return Math.round(delta * remainingFraction * 100) / 100;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly plansService: PlansService,
    private readonly auditService: AuditService,
    // Registered directly here (not via OrganizationsModule/OrganizationsRepository) to avoid
    // a circular module dependency — OrganizationsModule already imports SubscriptionsModule.
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
    private readonly eventBus: EventBusService,
    // IdentityModule is already imported by SubscriptionsModule (EntitlementsService needs it),
    // so this adds no new module edge and no cycle.
    private readonly membershipsService: MembershipsService,
    // BILLING_CHARGEABLE_CURRENCIES — which currencies the configured Flow A provider can
    // actually collect. Read through ConfigService rather than process.env because DI genuinely
    // exists here, unlike storage.constants.ts which runs before Nest's config layer.
    private readonly configService: ConfigService,
    private readonly subscriptionInvoicesRepository: SubscriptionInvoicesRepository,
    private readonly countersService: CountersService,
  ) {}

  /**
   * A tenant may switch a product OFF freely — restricting its own access is always its call.
   * Switching one ON is only allowed when the plan already grants every module that product
   * carries, i.e. when the override changes nothing about entitlement.
   *
   * Without this, the route was a monetization hole rather than a feature: it is gated on
   * `settings.manage`, which the tenant's own OWNER holds, and `resolveEffectiveModules` grants
   * a `true` product's modules "even if the plan doesn't include them (an add-on)" — so any
   * admin on the free plan could grant itself any of the four products in one request. The four
   * products are independently *entitleable* but there is no per-product price anywhere in the
   * model, so self-service add-ons were free by construction.
   *
   * Genuine add-ons beyond a plan are still possible, via scripts/set-product-overrides.ts —
   * deploy access as the authorization boundary, the same pattern manage-plans.ts and
   * create-platform-integration-account.ts already use for operator-only actions this RBAC
   * model has no role for.
   */
  private async assertOverridesWithinPlan(
    subscription: SubscriptionDocument,
    productOverrides: Partial<Record<KorvaProduct, boolean>>,
  ): Promise<void> {
    const granting = KORVA_PRODUCTS.filter(
      (product) => productOverrides[product] === true,
    );
    if (granting.length === 0) return;

    const plan = await this.plansService.getById(
      subscription.planId.toString(),
    );
    const planModules = new Set(plan.modules);
    for (const product of granting) {
      const missing = PRODUCT_MODULES[product].filter(
        (module) => !planModules.has(module),
      );
      if (missing.length > 0) {
        throw new ForbiddenException({
          code: 'PRODUCT_NOT_IN_PLAN',
          message: `Your plan ("${plan.name}") does not include the "${product}" product`,
          details: { product, plan: plan.key, missingModules: missing },
        });
      }
    }
  }

  /**
   * The currency every plan lookup for this organization is scoped to. Read straight off the
   * Organization rather than cached: it is set at onboarding and effectively immutable, and a
   * stale value here would mean selling a plan in the wrong currency.
   */
  private async organizationCurrency(
    organizationId: string,
  ): Promise<string | undefined> {
    const organization = await this.organizationModel
      .findById(organizationId)
      .select('currency')
      .exec();
    // `undefined` makes PlansService fall back to the platform default — correct for an
    // organization that somehow has no currency, rather than failing the whole lookup.
    return organization?.currency ?? undefined;
  }

  /** Called once, from OrganizationsService.createForOwner — every organization starts on "free". */
  async createDefaultSubscription(
    organizationId: string,
  ): Promise<SubscriptionDocument> {
    // The free plan is looked up in the organization's OWN currency, not the platform default:
    // a subscription is bound to the currency it was sold in, and starting every tenant on a
    // EUR subscription would make a later upgrade to an XOF tier a currency change rather than
    // a plan change. PlansService seeds "free" in every supported currency precisely so this
    // lookup can never miss.
    const plan = await this.plansService.getByKey(
      'free',
      await this.organizationCurrency(organizationId),
    );
    const now = new Date();
    return this.subscriptionsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      planId: plan._id,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: addOneMonth(now),
    });
  }

  async getForOrganization(
    organizationId: string,
  ): Promise<SubscriptionDocument> {
    const subscription =
      await this.subscriptionsRepository.findForOrganization(organizationId);
    if (!subscription) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: 'No subscription found for this organization',
      });
    }
    return subscription;
  }

  /**
   * The plan every entitlement reads: the billed plan, or — while a signup trial runs and ranks
   * above it — the trial plan, in the billed plan's currency. A trial therefore needs no
   * scheduler to END: the moment trialEndsAt passes, this answers the billed plan again. (The
   * period sweep then settles enabledModules — see settleExpiredTrials.)
   */
  async getActivePlan(organizationId: string): Promise<PlanDocument> {
    const subscription = await this.getForOrganization(organizationId);
    const billed = await this.plansService.getById(
      subscription.planId.toString(),
    );
    if (
      subscription.trialPlanKey &&
      subscription.trialEndsAt &&
      subscription.trialEndsAt > new Date() &&
      !planMeetsMinimum(billed.key, subscription.trialPlanKey as never)
    ) {
      return this.plansService.getByKey(
        subscription.trialPlanKey,
        billed.priceCurrency,
      );
    }
    return billed;
  }

  /**
   * Starts the signup trial (SIGNUP_TRIAL): once per organization, and only from the free plan.
   * The billed plan is untouched — no invoice, nothing to cancel — so the trial is purely a
   * window during which getActivePlan answers Pro.
   */
  async startTrial(
    organizationId: string,
    userId: string,
  ): Promise<SubscriptionDocument> {
    const subscription = await this.getForOrganization(organizationId);
    if (subscription.trialStartedAt) {
      throw new ConflictException({
        code: 'TRIAL_ALREADY_USED',
        message: 'This organization has already used its trial',
      });
    }
    const billed = await this.plansService.getById(
      subscription.planId.toString(),
    );
    if (billed.key !== 'free') {
      throw new ConflictException({
        code: 'TRIAL_NOT_AVAILABLE',
        message: 'The trial is only available on the free plan',
      });
    }
    const now = new Date();
    subscription.trialPlanKey = SIGNUP_TRIAL.plan;
    subscription.trialStartedAt = now;
    subscription.trialEndsAt = new Date(
      now.getTime() + SIGNUP_TRIAL.days * 24 * 60 * 60 * 1000,
    );
    await subscription.save();

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'subscription',
      entityId: subscription.id as string,
      metadata: { trial: SIGNUP_TRIAL.plan, endsAt: subscription.trialEndsAt },
    });
    return subscription;
  }

  /**
   * A KORVA administrator giving an organization more trial time — a prospect who needs another
   * week to decide. Adds `days` to a trial still running, or opens a new one from now when none
   * runs (also on an organization that already used its signup trial: this is a deliberate,
   * audited exception, unlike startTrial). Clearing trialSettledAt lets the period sweep settle
   * it again when it ends.
   */
  async extendTrial(
    organizationId: string,
    adminUserId: string,
    days: number,
  ): Promise<SubscriptionDocument> {
    const subscription = await this.getForOrganization(organizationId);
    const now = new Date();
    const from =
      subscription.trialEndsAt && subscription.trialEndsAt > now
        ? subscription.trialEndsAt
        : now;
    subscription.trialPlanKey = subscription.trialPlanKey ?? SIGNUP_TRIAL.plan;
    subscription.trialStartedAt = subscription.trialStartedAt ?? now;
    subscription.trialEndsAt = new Date(
      from.getTime() + days * 24 * 60 * 60 * 1000,
    );
    subscription.trialSettledAt = null;
    await subscription.save();

    await this.auditService.record({
      organizationId,
      userId: adminUserId,
      action: 'UPDATE',
      entity: 'subscription',
      entityId: subscription.id as string,
      metadata: {
        trialExtendedByDays: days,
        endsAt: subscription.trialEndsAt,
        by: 'platform_admin',
      },
    });
    return subscription;
  }

  /**
   * After a trial ends, brings enabledModules back to what the billed plan grants: modules the
   * plan lacks are switched off, and on a plan without both sales channels the one the type of
   * activity does not sell through is too. DATA IS NOT TOUCHED — an offer, a campaign, a variant
   * created during the trial stays; switching a module back on after upgrading shows it again.
   *
   * Called by the period sweep. Idempotent: a settled trial is never picked again.
   */
  async settleExpiredTrials(now: Date = new Date()): Promise<number> {
    const expired =
      await this.subscriptionsRepository.findExpiredUnsettledTrials(now);
    for (const subscription of expired) {
      const organizationId = subscription.organizationId.toString();
      const billed = await this.plansService.getById(
        subscription.planId.toString(),
      );
      const organization = await this.organizationModel
        .findById(organizationId)
        .exec();
      if (organization) {
        const allowed = resolveEffectiveModules(
          billed.modules,
          subscription.productOverrides,
        );
        let kept = organization.enabledModules.filter((module) =>
          allowed.includes(module),
        );
        if (
          !planHasFeature(billed.key, 'both_channels') &&
          kept.includes('booking') &&
          kept.includes('commerce')
        ) {
          const businessModel = organization.businessModel;
          const sellsOrders =
            businessModel !== undefined &&
            BUSINESS_MODEL_DEFINITIONS[businessModel].primaryChannel ===
              'orders';
          kept = kept.filter(
            (module) => module !== (sellsOrders ? 'booking' : 'commerce'),
          );
        }
        if (kept.length !== organization.enabledModules.length) {
          organization.enabledModules = kept;
          await organization.save();
        }
      }
      subscription.trialSettledAt = now;
      await subscription.save();
    }
    return expired.length;
  }

  /**
   * `manualPayment`: a KORVA administrator assigning the plan after collecting the payment
   * themselves (Mobile Money, cash, transfer) — see PlatformAdminService.assignPlan. It skips
   * only the "can a provider charge this currency" refusal, which exists to stop an owner reaching
   * a checkout that cannot take their money; there is no checkout here. Seats and modules are
   * checked exactly as for an owner.
   */
  async changePlan(
    organizationId: string,
    userId: string | undefined,
    planKey: string,
    options: { manualPayment?: boolean; prepaid?: boolean } = {},
  ): Promise<SubscriptionDocument> {
    // Resolved in the organization's own currency: a tier the platform prices in EUR but not in
    // this tenant's currency is simply not sellable to them, and PLAN_NOT_FOUND says so rather
    // than quietly billing them in a currency their provider cannot charge.
    const plan = await this.plansService.getByKey(
      planKey,
      await this.organizationCurrency(organizationId),
    );

    // Refused here, before an invoice exists, rather than at the hosted checkout. Flow A resolves
    // ONE market-independent provider for every tenant, and the configured provider cannot charge
    // every currency this catalog is priced in (see CHARGEABLE_BILLING_CURRENCIES). Without this,
    // an owner in France would click through to a payment page and be rejected there by the
    // provider, with an opaque error and an unpaid invoice already issued in their name.
    //
    // Paid tiers only: the free plan involves no provider at all, so an organization in a
    // currency KORVA cannot yet collect still gets the whole free tier. Restricting the taking of
    // money, not the use of the product, is the honest shape of this limitation — and it means
    // DOWNGRADING to free is never blocked, which matters most for an organization whose currency
    // stopped being chargeable after it subscribed.
    const chargeable = parseChargeableCurrencies(
      this.configService.get<string>('BILLING_CHARGEABLE_CURRENCIES'),
    );
    if (
      !options.manualPayment &&
      !options.prepaid &&
      plan.priceAmount > 0 &&
      !isCurrencyChargeable(plan.priceCurrency, chargeable)
    ) {
      throw new UnprocessableEntityException({
        code: 'CURRENCY_NOT_CHARGEABLE',
        message: `KORVA cannot yet collect subscription payments in ${plan.priceCurrency}. Paid plans are available in ${chargeable.join(', ')} for now; the free plan is available everywhere.`,
        details: { currency: plan.priceCurrency, chargeable },
      });
    }

    const existing =
      await this.subscriptionsRepository.findForOrganization(organizationId);

    // Seats are the one entitlement that cannot be clamped silently, because clamping them means
    // locking real people out of their own work — so the plan change is REFUSED instead, and the
    // owner is told exactly how many members to remove first. Without this, nothing checked
    // seats on a plan change at all: assertSeatAvailable guards only addMember, so an
    // organization could go from Business (unlimited) to free (one seat) and keep every member
    // indefinitely. `-1` means unlimited and must not be read as a limit of minus one, which
    // would refuse every upgrade to the top tier.
    // Already paid for (a plan-change invoice): refusing now would keep the money and not the
    // plan. Seats are checked when the change is requested, before any payment.
    const seatLimit = plan.limits?.seats ?? -1;
    if (seatLimit !== -1 && !options.prepaid) {
      const seatsUsed =
        await this.membershipsService.countSeatsForOrganization(organizationId);
      if (seatsUsed > seatLimit) {
        throw new ConflictException({
          code: 'SEAT_LIMIT_EXCEEDED_BY_PLAN',
          message: `The "${plan.name}" plan includes ${seatLimit} seat(s) and this organization uses ${seatsUsed}. Remove ${seatsUsed - seatLimit} member(s) before changing plan.`,
          details: { plan: plan.key, seatLimit, seatsUsed },
        });
      }
    }

    // A downgrade must never leave enabledModules claiming access to a module the new plan (plus
    // any still-active product overrides) no longer grants — drop exactly those, keep everything
    // still allowed. Never add modules the organization hadn't already chosen to enable, even if
    // the new plan/overrides permit more than the old one.
    const organization = await this.organizationModel
      .findById(organizationId)
      .exec();
    if (organization) {
      const effectiveModules = resolveEffectiveModules(
        plan.modules,
        existing?.productOverrides,
      );
      const stillAllowed = organization.enabledModules.filter((module) =>
        effectiveModules.includes(module),
      );
      if (stillAllowed.length !== organization.enabledModules.length) {
        organization.enabledModules = stillAllowed;
        await organization.save();
      }
    }

    // Only worth computing against a genuinely still-running prior period — a subscription
    // already past its period end is about to be handled by the period scheduler anyway, and
    // proration against a period that's already over is meaningless.
    let prorationAmount: number | null = null;
    let prorationCurrency: string | null = null;
    const now = new Date();
    // Fetched unconditionally (not just inside the proration branch) because the
    // 'subscription.plan_changed' event below wants the previous plan key regardless of
    // whether the period was still running — proration is a pricing detail, "what plan was
    // this before" is a signal the Decision Engine cares about either way (e.g. a downgrade).
    const previousPlan = existing
      ? await this.plansService.getById(existing.planId.toString())
      : undefined;
    // A prepaid change was priced net of the unused paid period when its invoice was issued:
    // carrying a proration on top would count that credit twice.
    if (
      !options.prepaid &&
      existing &&
      previousPlan &&
      existing.currentPeriodEnd.getTime() > now.getTime()
    ) {
      prorationAmount = computeProration(
        previousPlan.priceAmount,
        previousPlan.priceCurrency,
        plan.priceAmount,
        plan.priceCurrency,
        existing.currentPeriodStart,
        existing.currentPeriodEnd,
        now,
      );
      prorationCurrency = prorationAmount !== null ? plan.priceCurrency : null;
    }

    const updated = await this.subscriptionsRepository.update(organizationId, {
      planId: plan._id,
      status: 'active',
      currentPeriodStart: now,
      currentPeriodEnd: addOneMonth(now),
      // Choosing a new plan is an active intent to keep the subscription — any pending
      // cancel-at-period-end request no longer applies to the (freshly extended) period.
      cancelAtPeriodEnd: false,
      cancelRequestedAt: null,
      prorationAmount,
      prorationCurrency,
      prorationCalculatedAt: prorationAmount !== null ? now : null,
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: 'No subscription found for this organization',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'SETTINGS_CHANGE',
      entity: 'subscription',
      entityId: updated.id as string,
      metadata: {
        plan: planKey,
        prorationAmount,
        prorationCurrency,
        ...(options.manualPayment
          ? { manualPayment: true, by: 'platform_admin' }
          : {}),
        ...(options.prepaid ? { prepaid: true } : {}),
      },
    });

    await this.eventBus.publish(organizationId, 'subscription.plan_changed', {
      subscriptionId: updated.id as string,
      planKey,
      previousPlanKey: previousPlan?.key,
    });

    return updated;
  }

  /**
   * What a business gets when it picks a plan itself (POST /subscriptions/change-plan): pay
   * first, then the plan opens. A free plan — or a change the unused paid period fully covers —
   * applies at once. A paid one issues a plan-change invoice (the new plan's price, minus the
   * unused part of the period already paid) and changes nothing until that invoice is settled
   * (SubscriptionBillingService.settleAsPaid -> applyPaidPlanChange). Before 2026-10-31 the plan
   * switched immediately and was billed at renewal, so a business could use Business for a
   * month — or indefinitely, by switching back and forth — without paying.
   */
  async requestPlanChange(
    organizationId: string,
    userId: string,
    planKey: string,
  ): Promise<
    | SubscriptionDocument
    | { paymentRequired: true; invoice: SubscriptionInvoiceDocument }
  > {
    const plan = await this.plansService.getByKey(
      planKey,
      await this.organizationCurrency(organizationId),
    );
    if (plan.priceAmount <= 0) {
      return this.changePlan(organizationId, userId, planKey);
    }

    const chargeable = parseChargeableCurrencies(
      this.configService.get<string>('BILLING_CHARGEABLE_CURRENCIES'),
    );
    if (!isCurrencyChargeable(plan.priceCurrency, chargeable)) {
      throw new UnprocessableEntityException({
        code: 'CURRENCY_NOT_CHARGEABLE',
        message: `KORVA cannot yet collect subscription payments in ${plan.priceCurrency}. Paid plans are available in ${chargeable.join(', ')} for now; the free plan is available everywhere.`,
        details: { currency: plan.priceCurrency, chargeable },
      });
    }
    const seatLimit = plan.limits?.seats ?? -1;
    if (seatLimit !== -1) {
      const seatsUsed =
        await this.membershipsService.countSeatsForOrganization(organizationId);
      if (seatsUsed > seatLimit) {
        throw new ConflictException({
          code: 'SEAT_LIMIT_EXCEEDED_BY_PLAN',
          message: `The "${plan.name}" plan includes ${seatLimit} seat(s) and this organization uses ${seatsUsed}. Remove ${seatsUsed - seatLimit} member(s) before changing plan.`,
          details: { plan: plan.key, seatLimit, seatsUsed },
        });
      }
    }

    const existing = await this.getForOrganization(organizationId);
    if (
      existing.planId.toString() === plan._id.toString() &&
      existing.status === 'active'
    ) {
      // Already on it (a double click): nothing to pay, nothing to change.
      return existing;
    }

    const now = new Date();
    const credit = await this.unusedPaidCredit(
      existing,
      plan.priceCurrency,
      now,
    );
    const amount = Math.max(
      0,
      Math.round((plan.priceAmount - credit) * 100) / 100,
    );
    if (amount === 0) {
      return this.changePlan(organizationId, userId, planKey);
    }

    // One pending change at a time: picking another plan replaces the unpaid one.
    await this.subscriptionInvoicesRepository.voidOpenPlanChanges(
      organizationId,
    );
    const invoice = await this.subscriptionInvoicesRepository.issueForPeriod({
      organizationId: new Types.ObjectId(organizationId),
      subscriptionId: existing._id,
      planId: plan._id,
      kind: 'plan_change',
      number: await this.countersService.nextFormatted(
        organizationId,
        'subscription-invoice',
        'ABO',
      ),
      periodStart: now,
      periodEnd: addOneMonth(now),
      amount,
      currency: plan.priceCurrency,
      issuedAt: now,
      dueAt: new Date(now.getTime() + 7 * 86_400_000),
    });
    if (!invoice) {
      throw new ConflictException({
        code: 'PLAN_CHANGE_IN_PROGRESS',
        message: 'A plan change was just requested — try again in a moment',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'SETTINGS_CHANGE',
      entity: 'subscription',
      entityId: existing.id as string,
      metadata: {
        reason: 'plan_change_payment_required',
        plan: planKey,
        invoiceNumber: invoice.number,
        amount,
        credit,
      },
    });
    return { paymentRequired: true, invoice };
  }

  /** Called once a plan-change invoice is paid: the plan it was issued for opens now. */
  async applyPaidPlanChange(
    invoice: SubscriptionInvoiceDocument,
  ): Promise<SubscriptionDocument> {
    const plan = await this.plansService.getById(invoice.planId.toString());
    return this.changePlan(
      invoice.organizationId.toString(),
      undefined,
      plan.key,
      {
        prepaid: true,
      },
    );
  }

  /** Cancels a requested, still unpaid plan change. */
  async cancelPendingPlanChange(organizationId: string): Promise<number> {
    return this.subscriptionInvoicesRepository.voidOpenPlanChanges(
      organizationId,
    );
  }

  /**
   * The unused part of the period the business actually PAID for — read from the paid invoice
   * covering today, never from the plan's list price (a trial or a manual arrangement paid
   * nothing, so it credits nothing).
   */
  private async unusedPaidCredit(
    subscription: SubscriptionDocument,
    currency: string,
    now: Date,
  ): Promise<number> {
    const paid = await this.subscriptionInvoicesRepository.findPaidCovering(
      subscription.id as string,
      now,
    );
    if (
      !paid ||
      paid.currency !== currency ||
      paid.planId.toString() !== subscription.planId.toString()
    ) {
      return 0;
    }
    const total = paid.periodEnd.getTime() - paid.periodStart.getTime();
    if (total <= 0) return 0;
    const left = Math.max(0, paid.periodEnd.getTime() - now.getTime());
    return Math.round(((paid.amount * left) / total) * 100) / 100;
  }

  /**
   * `immediate: true` revokes access now — status becomes 'canceled' right away.
   * `immediate: false` (default) is the standard SaaS UX: the subscription stays 'active' and
   * usable until currentPeriodEnd, only flagging cancelAtPeriodEnd — SubscriptionPeriodScheduler
   * performs the actual terminal transition once that date passes. See reactivate() for undoing
   * this while still within the grace window.
   */
  async cancel(
    organizationId: string,
    userId: string,
    immediate: boolean,
  ): Promise<SubscriptionDocument> {
    // Surfaces a clean 404 (no subscription at all) distinctly from the 409s below.
    await this.getForOrganization(organizationId);

    const updated = immediate
      ? await this.subscriptionsRepository.cancelNow(organizationId)
      : await this.subscriptionsRepository.requestCancelAtPeriodEnd(
          organizationId,
        );

    if (!updated) {
      throw new ConflictException({
        code: 'SUBSCRIPTION_CANCEL_CONFLICT',
        message: immediate
          ? 'This subscription is already canceled'
          : 'This subscription is already canceled or already scheduled to cancel at period end',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'SETTINGS_CHANGE',
      entity: 'subscription',
      entityId: updated.id as string,
      metadata: { cancel: immediate ? 'immediate' : 'at_period_end' },
    });

    return updated;
  }

  /**
   * Undoes a pending cancel-at-period-end request while still within the grace window (status
   * still 'active' and currentPeriodEnd still in the future — see
   * SubscriptionsRepository.reactivateIfEligible). Fails on an immediately-canceled subscription
   * (there is no grace window for that) and on one whose period has already elapsed, even if the
   * scheduler hasn't ticked yet to formally flip it to 'canceled'.
   */
  async reactivate(
    organizationId: string,
    userId: string,
  ): Promise<SubscriptionDocument> {
    await this.getForOrganization(organizationId);

    const updated =
      await this.subscriptionsRepository.reactivateIfEligible(organizationId);
    if (!updated) {
      throw new ConflictException({
        code: 'SUBSCRIPTION_REACTIVATE_NOT_ELIGIBLE',
        message:
          'This subscription cannot be reactivated — it is not pending cancellation within its grace window',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'SETTINGS_CHANGE',
      entity: 'subscription',
      entityId: updated.id as string,
      metadata: { reactivated: true },
    });

    return updated;
  }

  /**
   * Replaces the whole productOverrides map (same "full replacement, not a single-key patch"
   * idiom as OrganizationsService.update's enabledModules). Also re-prunes the organization's
   * live enabledModules exactly like changePlan does — without this, disabling a product here
   * would leave stale access in enabledModules (the array ModuleGuard actually enforces per
   * request), the same class of gap this whole feature exists to close.
   */
  async updateProductOverrides(
    organizationId: string,
    userId: string,
    productOverrides: Partial<Record<KorvaProduct, boolean>>,
  ): Promise<SubscriptionDocument> {
    const subscription = await this.getForOrganization(organizationId);
    await this.assertOverridesWithinPlan(subscription, productOverrides);

    const updated = await this.subscriptionsRepository.update(organizationId, {
      productOverrides,
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'SUBSCRIPTION_NOT_FOUND',
        message: 'No subscription found for this organization',
      });
    }

    const plan = await this.plansService.getById(updated.planId.toString());
    const organization = await this.organizationModel
      .findById(organizationId)
      .exec();
    if (organization) {
      const effectiveModules = resolveEffectiveModules(
        plan.modules,
        productOverrides,
      );
      const stillAllowed = organization.enabledModules.filter((module) =>
        effectiveModules.includes(module),
      );
      if (stillAllowed.length !== organization.enabledModules.length) {
        organization.enabledModules = stillAllowed;
        await organization.save();
      }
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'SETTINGS_CHANGE',
      entity: 'subscription',
      entityId: updated.id as string,
      metadata: { productOverrides },
    });

    return updated;
  }
}
