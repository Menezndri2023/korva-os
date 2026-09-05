import { ForbiddenException, Injectable } from '@nestjs/common';
import type {
  KorvaModule,
  StorefrontFontPairingKey,
  StorefrontPaletteKey,
  StorefrontTemplateKey,
  UsageSummaryItem,
} from '@korva/types';
import {
  getStorefrontTemplate,
  planMeetsMinimum,
  resolveEffectiveModules,
} from '@korva/types';
import { SubscriptionsService } from './subscriptions.service';
import { UsageRepository } from './usage.repository';
import { MembershipsService } from '../identity/memberships/memberships.service';

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
  ) {}

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

    const canRefine = planMeetsMinimum(
      plan.key,
      templateDef.refinedChoiceMinPlan,
    );
    const allowedPalettes = canRefine
      ? templateDef.palettes
      : templateDef.palettes.slice(0, 1);
    const allowedFontPairings = canRefine
      ? templateDef.fontPairings
      : templateDef.fontPairings.slice(0, 1);

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
  async assertContentSectionsAllowed(organizationId: string): Promise<void> {
    await this.assertSubscriptionActive(organizationId);
    const plan = await this.subscriptionsService.getActivePlan(organizationId);
    if (!planMeetsMinimum(plan.key, 'pro')) {
      throw new ForbiddenException({
        code: 'STOREFRONT_CONTENT_SECTIONS_NOT_IN_PLAN',
        message: `Your plan ("${plan.name}") does not include storefront content sections (testimonials, team, gallery, about, FAQ) — upgrade to Pro or higher`,
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
      await this.membershipsService.countForOrganization(organizationId);
    if (count >= limit) {
      throw new ForbiddenException({
        code: 'SEAT_LIMIT_REACHED',
        message: `Your plan ("${plan.name}") allows up to ${limit} team members`,
        details: { limit, used: count },
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
        used:
          metric === 'seats'
            ? await this.membershipsService.countForOrganization(organizationId)
            : await this.usageRepository.getCount(
                organizationId,
                metric,
                period,
              ),
      })),
    );
  }
}
