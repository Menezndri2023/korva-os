import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import type {
  CountedMetric,
  PlanFeature,
  KorvaModule,
  StorefrontFontPairingKey,
  StorefrontPaletteKey,
  StorefrontTemplateKey,
  UsageSummaryItem,
} from '@korva/types';
import {
  COUNTED_METRICS,
  CUSTOM_DOMAIN_MIN_PLAN,
  EXTRA_SEAT_PRICES,
  EXTRA_SEAT_PURCHASABLE,
  PLAN_FEATURE_LABELS,
  PLAN_FEATURE_MIN_PLAN,
  organizationHasFeature,
  planHasFeature,
  PLAN_FEATURE_OPEN_BEFORE,
  getStorefrontTemplate,
  selectableFontPairings,
  selectablePalettes,
  planMeetsMinimum,
  resolveEffectiveModules,
} from '@korva/types';
import { SubscriptionsService } from './subscriptions.service';
import { UsageRepository } from './usage.repository';
import { MembershipsService } from '../identity/memberships/memberships.service';

/** What each counted metric counts, as a filter on its collection. See COUNTED_METRICS. */
const COUNT_QUERIES: Record<
  Exclude<CountedMetric, 'seats'>,
  { collection: string; filter: Record<string, unknown> }
> = {
  offers: { collection: 'offers', filter: { status: { $ne: 'archived' } } },
  bookable_staff: {
    collection: 'resources',
    filter: { type: 'person', active: true },
  },
  workflows: { collection: 'workflows', filter: {} },
};

const COUNTED_METRIC_LABELS: Record<CountedMetric, string> = {
  seats: 'dashboard users',
  offers: 'offers in the catalogue',
  bookable_staff: 'bookable team members',
  workflows: 'automations',
};

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

/**
 * Single source of truth for "can this organization do X?" — every check here is derived
 * from the organization's active Subscription/Plan, never hardcoded. See docs/ai.md and
 * docs/IMPLEMENTATION_PLAN.md Phase 10.
 *
 * SUBSCRIPTION STATUS ENFORCEMENT (Wave 3): a `canceled` subscription must block real access —
 * see SubscriptionsService.cancel's own doc comment ("`immediate: true` revokes access now") and
 * the e2e test named exactly that ("immediate=true revokes access now"). Before this change that
 * promise was never kept: every check below resolved the plan straight from
 * `subscription.planId`, completely ignoring `subscription.status`, so a canceled organization
 * kept every module/seat/usage entitlement of its last plan forever.
 *
 * Policy chosen — immediate hard lockout on `status === 'canceled'`, applied only to the three
 * *consuming/growing* actions below (enabling a new module, adding a new seat, recording new AI
 * usage). Reasoning, to let a product owner override this if wrong:
 *   - `cancelAtPeriodEnd` (the default, non-immediate cancel) is already this codebase's one
 *     grace period: status stays 'active' — and therefore fully entitled — until
 *     currentPeriodEnd, exactly like today. A second grace period starting only once `status`
 *     actually flips to 'canceled' would be redundant with that existing mechanism, not a new
 *     requirement.
 *   - Downgrading a canceled org to the `free` plan (rather than a hard lockout) was considered
 *     but rejected: `free` in PlansService.DEFAULT_PLANS deliberately grants ALL_MODULES (it's
 *     the generous onboarding default), so "downgrade to free" would not actually revoke module
 *     access at all — only shrink quotas — which contradicts the explicit "revokes access now"
 *     language already written for immediate cancellation.
 *   - The lockout is scoped narrowly on purpose: it does not touch `getSummary`/
 *     `getUsageSummary` (read-only, must keep working so the UI can show "canceled" and offer
 *     reactivate/change-plan) and it does not touch SubscriptionsController's own
 *     change-plan/cancel/reactivate endpoints (they never call EntitlementsService), so a
 *     canceled organization can always still fix its own subscription.
 *   - `past_due` is a modeled-but-currently-unreachable status (see packages/types/src/
 *     subscriptions.ts — "nothing sets it yet", no PSP integration exists to produce it) and is
 *     deliberately left alone here to keep this change minimal; wire it in analogously once a
 *     real failed-payment path exists.
 */
@Injectable()
export class EntitlementsService {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly usageRepository: UsageRepository,
    private readonly membershipsService: MembershipsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  /** Whether the organization's active plan includes a feature — for read paths that degrade
   *  (the storefront hiding online payment) rather than refuse. */
  async hasFeature(
    organizationId: string,
    feature: PlanFeature,
  ): Promise<boolean> {
    const plan = await this.subscriptionsService.getActivePlan(organizationId);
    if (planHasFeature(plan.key, feature)) return true;
    return this.openedBeforeGate(organizationId, feature);
  }

  /** PLAN_FEATURE_OPEN_BEFORE: an organization older than the gate keeps the feature. */
  private async openedBeforeGate(
    organizationId: string,
    feature: PlanFeature,
  ): Promise<boolean> {
    if (!PLAN_FEATURE_OPEN_BEFORE[feature]) return false;
    const organization = await this.connection
      .collection('organizations')
      .findOne(
        { _id: new Types.ObjectId(organizationId) },
        { projection: { createdAt: 1 } },
      );
    return organizationHasFeature(
      'free',
      feature,
      organization?.createdAt as Date | undefined,
    );
  }

  /** Refuses an action the active plan does not include. See PLAN_FEATURE_MIN_PLAN. */
  async assertFeature(
    organizationId: string,
    feature: PlanFeature,
  ): Promise<void> {
    await this.assertSubscriptionActive(organizationId);
    const plan = await this.subscriptionsService.getActivePlan(organizationId);
    if (planHasFeature(plan.key, feature)) return;
    if (await this.openedBeforeGate(organizationId, feature)) return;
    const minPlan = PLAN_FEATURE_MIN_PLAN[feature];
    throw new ForbiddenException({
      code: 'PLAN_FEATURE_NOT_INCLUDED',
      message: `Your plan ("${plan.name}") does not include "${PLAN_FEATURE_LABELS[feature]}" — upgrade to ${minPlan} or higher`,
      // Top-level: HttpExceptionFilter gathers these into error.details.
      feature,
      minPlan,
      plan: plan.key,
    });
  }

  /** Current count of a counted metric for one organization. */
  async countMetric(
    organizationId: string,
    metric: CountedMetric,
  ): Promise<number> {
    if (metric === 'seats') {
      return this.membershipsService.countSeatsForOrganization(organizationId);
    }
    const { collection, filter } = COUNT_QUERIES[metric];
    return this.connection.collection(collection).countDocuments({
      organizationId: new Types.ObjectId(organizationId),
      ...filter,
    });
  }

  /**
   * Refuses to ADD one more of `metric` when the plan's limit is already reached. Called before
   * creating the item (or bringing one back into the count), never to remove anything: an
   * organization above a limit keeps what it has — see COUNTED_METRICS.
   *
   * The count is read before the write, outside any transaction, so two simultaneous creations
   * at the limit can both pass. Accepted: these are catalogue sizes, not money, and one item over
   * a free-plan limit costs nothing — unlike stock or bookings, which do lock.
   */
  async assertCountWithinLimit(
    organizationId: string,
    metric: Exclude<CountedMetric, 'seats'>,
  ): Promise<void> {
    await this.assertSubscriptionActive(organizationId);
    const plan = await this.subscriptionsService.getActivePlan(organizationId);
    const limit = plan.limits[metric] ?? -1;
    if (limit === -1) return;

    const used = await this.countMetric(organizationId, metric);
    if (used >= limit) {
      throw new ForbiddenException({
        code: 'PLAN_LIMIT_REACHED',
        message: `Your plan ("${plan.name}") allows up to ${limit} ${COUNTED_METRIC_LABELS[metric]} — upgrade to add more`,
        // Top-level keys, not a `details` object: HttpExceptionFilter collects whatever follows
        // code/message into `error.details` itself (a literal `details` key nests twice).
        metric,
        limit,
        used,
        plan: plan.key,
      });
    }
  }

  /**
   * Throws if the organization's subscription has been canceled. Only called from the
   * consuming/growing checks (module enablement, seat addition, usage recording) — never from
   * read-only summaries, and never from the subscription-management endpoints themselves, so a
   * canceled organization can always still view its state and reactivate/change plan.
   */
  private async assertSubscriptionActive(
    organizationId: string,
  ): Promise<void> {
    const subscription =
      await this.subscriptionsService.getForOrganization(organizationId);
    if (subscription.status === 'canceled') {
      throw new ForbiddenException({
        code: 'SUBSCRIPTION_CANCELED',
        message:
          "This organization's subscription has been canceled. Reactivate it or choose a new plan to restore access.",
      });
    }
  }

  async assertModulesAllowed(
    organizationId: string,
    requestedModules: KorvaModule[],
  ): Promise<void> {
    await this.assertSubscriptionActive(organizationId);
    const subscription =
      await this.subscriptionsService.getForOrganization(organizationId);
    const plan = await this.subscriptionsService.getActivePlan(organizationId);
    const effectiveModules = resolveEffectiveModules(
      plan.modules,
      subscription.productOverrides,
    );
    const notAllowed = requestedModules.filter(
      (m) => !effectiveModules.includes(m),
    );
    if (notAllowed.length > 0) {
      throw new ForbiddenException({
        code: 'MODULE_NOT_IN_PLAN',
        message: `Your plan ("${plan.name}") does not include: ${notAllowed.join(', ')}`,
        details: { modules: notAllowed, plan: plan.key },
      });
    }

    // One sales channel on Free: bookings OR orders, the one its type of activity is built
    // around (PLAN_FEATURE_MIN_PLAN.both_channels). Only refused when it would be NEW — an
    // organization that already runs both, created before this rule or under a paid plan,
    // keeps them.
    if (
      requestedModules.includes('booking') &&
      requestedModules.includes('commerce') &&
      !planHasFeature(plan.key, 'both_channels')
    ) {
      const organization = await this.connection
        .collection('organizations')
        .findOne(
          { _id: new Types.ObjectId(organizationId) },
          { projection: { enabledModules: 1 } },
        );
      const current =
        (organization?.enabledModules as string[] | undefined) ?? [];
      if (!(current.includes('booking') && current.includes('commerce'))) {
        await this.assertFeature(organizationId, 'both_channels');
      }
    }
  }

  /**
   * Gates the storefront visual template/palette/font-pairing an organization can save — see
   * @korva/types storefront-themes.ts. `template` is the *effective* template for this update
   * (caller resolves: the value being set, or the organization's current one if this update
   * only touches palette/fontPairing) so a palette-only PATCH is still checked against the
   * right template's allowed lists.
   */
  async assertStorefrontThemeAllowed(
    organizationId: string,
    theme: {
      template?: StorefrontTemplateKey;
      palette?: StorefrontPaletteKey;
      fontPairing?: StorefrontFontPairingKey;
    },
  ): Promise<void> {
    if (!theme.template) return;
    await this.assertSubscriptionActive(organizationId);
    const plan = await this.subscriptionsService.getActivePlan(organizationId);
    const templateDef = getStorefrontTemplate(theme.template);

    if (!planMeetsMinimum(plan.key, templateDef.minPlan)) {
      throw new ForbiddenException({
        code: 'STOREFRONT_TEMPLATE_NOT_IN_PLAN',
        message: `Your plan ("${plan.name}") does not include the "${templateDef.label}" storefront template`,
        details: { template: theme.template, plan: plan.key },
      });
    }

    // The template's own choices (all of them from its refined plan) plus the premium ones.
    const allowedPalettes = selectablePalettes(templateDef, plan.key);
    const allowedFontPairings = selectableFontPairings(templateDef, plan.key);

    if (theme.palette && !allowedPalettes.includes(theme.palette)) {
      throw new ForbiddenException({
        code: 'STOREFRONT_PALETTE_NOT_IN_PLAN',
        message: `Your plan ("${plan.name}") does not include this palette for the "${templateDef.label}" template`,
        details: { palette: theme.palette, plan: plan.key },
      });
    }
    if (theme.fontPairing && !allowedFontPairings.includes(theme.fontPairing)) {
      throw new ForbiddenException({
        code: 'STOREFRONT_FONT_PAIRING_NOT_IN_PLAN',
        message: `Your plan ("${plan.name}") does not include this font pairing for the "${templateDef.label}" template`,
        details: { fontPairing: theme.fontPairing, plan: plan.key },
      });
    }
  }

  /**
   * Gates the storefront "content" sections (testimonials/team/gallery/about) behind the Pro
   * plan — a flat gate, unlike assertStorefrontThemeAllowed's per-template minimum, since the
   * user explicitly chose "Pro unlocks everything" for these rather than a graduated rollout.
   */
  /**
   * Gates attaching a custom domain behind Starter. Ungated until 2026-10-12, which meant a
   * free organization could point its own domain at the platform and have Caddy issue it a TLS
   * certificate — real infrastructure and support cost, for the single clearest "I am a paying
   * business" signal in the product.
   *
   * A flat Starter gate rather than a per-tier one: there is nothing graduated about owning a
   * domain. Note this gates ATTACHING one, not serving one already attached — a subscription
   * that lapses does not silently take a live site offline, which would be a far harsher
   * failure than refusing the next change.
   */
  async assertCustomDomainAllowed(organizationId: string): Promise<void> {
    await this.assertSubscriptionActive(organizationId);
    const plan = await this.subscriptionsService.getActivePlan(organizationId);
    if (!planMeetsMinimum(plan.key, CUSTOM_DOMAIN_MIN_PLAN)) {
      throw new ForbiddenException({
        code: 'CUSTOM_DOMAIN_NOT_IN_PLAN',
        message: `Your plan ("${plan.name}") does not include a custom domain — upgrade to Starter or higher`,
        details: { plan: plan.key },
      });
    }
  }

  async assertSeatAvailable(organizationId: string): Promise<void> {
    await this.assertSubscriptionActive(organizationId);
    const plan = await this.subscriptionsService.getActivePlan(organizationId);
    const limit = plan.limits.seats ?? -1;
    if (limit === -1) return;

    const count =
      await this.membershipsService.countSeatsForOrganization(organizationId);
    if (count >= limit) {
      const currency = plan.priceCurrency as keyof typeof EXTRA_SEAT_PRICES;
      throw new ForbiddenException({
        code: 'SEAT_LIMIT_REACHED',
        message: `Your plan ("${plan.name}") allows up to ${limit} dashboard users`,
        // The extra-seat price is shown to the owner with this refusal; `purchasable` says
        // whether it can actually be bought yet (see EXTRA_SEAT_PURCHASABLE). Top-level keys,
        // as HttpExceptionFilter gathers them into `error.details`.
        limit,
        used: count,
        extraSeat: {
          price: EXTRA_SEAT_PRICES[currency] ?? null,
          currency,
          purchasable: EXTRA_SEAT_PURCHASABLE,
        },
      });
    }
  }

  /** Throws if the metric's monthly quota is already reached, otherwise records one unit of usage. */
  async checkAndRecordUsage(
    organizationId: string,
    metric: string,
  ): Promise<void> {
    await this.assertSubscriptionActive(organizationId);
    const plan = await this.subscriptionsService.getActivePlan(organizationId);
    const limit = plan.limits[metric] ?? -1;
    const period = currentPeriod();

    if (limit !== -1) {
      const used = await this.usageRepository.getCount(
        organizationId,
        metric,
        period,
      );
      if (used >= limit) {
        throw new ForbiddenException({
          code: 'USAGE_LIMIT_REACHED',
          message: `Your plan ("${plan.name}") allows up to ${limit} "${metric}" per month`,
          details: { metric, limit, used },
        });
      }
    }

    await this.usageRepository.increment(organizationId, metric, period);
  }

  /** Undoes one checkAndRecordUsage when the thing counted did not happen after all — KORVA IA
   *  uses it when the AI provider could not answer, so a business is never charged a message
   *  nobody replied to. Same period as the count it undoes, unless the month just turned. */
  async refundUsage(organizationId: string, metric: string): Promise<void> {
    await this.usageRepository.decrement(
      organizationId,
      metric,
      currentPeriod(),
    );
  }

  async getSummary(organizationId: string) {
    const subscription =
      await this.subscriptionsService.getForOrganization(organizationId);
    const plan = await this.subscriptionsService.getActivePlan(organizationId);
    const usage = await this.getUsageSummary(organizationId);
    return { subscription, plan, usage };
  }

  async getUsageSummary(organizationId: string): Promise<UsageSummaryItem[]> {
    const plan = await this.subscriptionsService.getActivePlan(organizationId);
    const period = currentPeriod();

    return Promise.all(
      Object.entries(plan.limits).map(async ([metric, limit]) => ({
        metric,
        limit,
        used: (COUNTED_METRICS as readonly string[]).includes(metric)
          ? await this.countMetric(organizationId, metric as CountedMetric)
          : await this.usageRepository.getCount(organizationId, metric, period),
      })),
    );
  }
}
