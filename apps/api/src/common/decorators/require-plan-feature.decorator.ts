import { SetMetadata } from '@nestjs/common';
import type { PlanFeature } from '@korva/types';

export const PLAN_FEATURE_KEY = 'requiredPlanFeature';

/**
 * Requires the organization's active plan to include this feature (PLAN_FEATURE_MIN_PLAN in
 * @korva/types). Put it on the routes that ADD or CHANGE things, not on reads: data created
 * under a higher plan stays visible after a downgrade.
 */
export const RequirePlanFeature = (feature: PlanFeature) =>
  SetMetadata(PLAN_FEATURE_KEY, feature);
