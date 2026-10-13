import { Types } from 'mongoose';
import type { Connection } from 'mongoose';
import type { PlanKey } from '@korva/types';

/**
 * Points an organization's subscription at a plan tier, by writing the collections directly.
 *
 * WHY THIS EXISTS. Every organization is created on the free plan, and `finance`, `marketing`
 * and `ai` are paid modules (see @korva/types/plan-tiers.ts). 24 e2e specs here enable one of
 * those with `PATCH /organizations/me` as scaffolding before exercising an unrelated feature —
 * so the moment `finance` moved from free to Starter, assertModulesAllowed answered 403, the
 * `beforeAll` of each of those suites threw, and all 24 suites failed at once, taking the whole
 * e2e run to a heap exhaustion with 24 half-initialised Nest apps in one worker.
 *
 * Those specs are not about plan gating: the gating is covered by entitlements.service.spec.ts
 * and subscriptions.e2e-spec.ts. Their free-plan module list was incidental scaffolding that
 * happened to work while `free` granted all eleven modules. Calling this first says what they
 * always meant — "this organization pays for the features under test".
 *
 * DIRECT WRITES RATHER THAN POST /subscriptions/change-plan, deliberately: a real plan change
 * issues a SubscriptionInvoice and can leave the subscription `past_due` under Flow A billing,
 * so driving it through the API would make two dozen feature specs depend on the billing
 * pipeline succeeding. Here the tier is scaffolding, so it is set the shortest way that has no
 * side effects.
 *
 * The plan catalog is already seeded by the time any spec can call this: creating the
 * organization looks up ('free', its currency), and that lookup is what triggers
 * PlansService.ensureSeeded.
 */
export async function putOrganizationOnPlan(
  connection: Connection,
  organizationId: string,
  planKey: PlanKey = 'business',
): Promise<void> {
  const orgId = new Types.ObjectId(organizationId);

  const organization = await connection
    .collection('organizations')
    .findOne({ _id: orgId }, { projection: { currency: 1 } });
  if (!organization) {
    throw new Error(`putOrganizationOnPlan: no organization ${organizationId}`);
  }
  const currency = (organization.currency as string | undefined) ?? 'EUR';

  const plan = await connection
    .collection('plans')
    .findOne(
      { key: planKey, priceCurrency: currency },
      { projection: { _id: 1 } },
    );
  if (!plan) {
    // Loud rather than silent: a missing (tier, currency) row means the catalog did not seed,
    // and every assertion after this would fail for a reason that looks nothing like the cause.
    throw new Error(
      `putOrganizationOnPlan: no "${planKey}" plan priced in ${currency}`,
    );
  }

  const result = await connection
    .collection('subscriptions')
    .updateOne(
      { organizationId: orgId },
      { $set: { planId: plan._id, status: 'active', updatedAt: new Date() } },
    );
  if (result.matchedCount === 0) {
    throw new Error(
      `putOrganizationOnPlan: organization ${organizationId} has no subscription`,
    );
  }
}
