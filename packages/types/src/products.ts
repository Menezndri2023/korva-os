import type { KorvaModule } from "./organization.ts";

export const KORVA_PRODUCTS = ["crm", "inventory", "website", "ai"] as const;
export type KorvaProduct = (typeof KORVA_PRODUCTS)[number];

/**
 * Which KorvaModules each product grants. Deliberately overlapping — `finance` and `booking`
 * are genuinely cross-cutting (client billing serves CRM, supplier POs serve Inventory;
 * booking serves CRM-style client engagement across several verticals). A module can appear
 * in more than one product's list.
 * INVARIANT: every KORVA_MODULE must appear in at least one product's list, or a `false`
 * override could never be un-strippable for it — see products.spec.ts.
 */
export const PRODUCT_MODULES: Record<KorvaProduct, KorvaModule[]> = {
  crm: ["crm", "communication", "workflow", "analytics", "finance", "booking"],
  inventory: ["catalog", "commerce", "finance"],
  website: ["website"],
  ai: ["ai"],
};

/**
 * Folds per-product overrides onto a plan's flat module list. Empty/undefined overrides
 * returns `planModules` unchanged — zero behavior change for every org today (none has
 * `productOverrides` set). `true` force-grants a product's modules even if the plan doesn't
 * include them (an add-on). `false` force-strips a product's modules UNLESS another
 * still-active product (or the plan directly) also grants that specific module — so disabling
 * "inventory" never accidentally removes `finance` if CRM is still active and using it.
 *
 * Note this can strip a module the plan grants directly, not just one added by another
 * override — `productOverrides` is a layer that can restrict an otherwise-generous plan, not
 * only add on top of a strict one.
 */
export function resolveEffectiveModules(
  planModules: KorvaModule[],
  overrides: Partial<Record<KorvaProduct, boolean>> = {},
): KorvaModule[] {
  const result = new Set(planModules);
  for (const product of KORVA_PRODUCTS) {
    if (overrides[product] === true) {
      for (const m of PRODUCT_MODULES[product]) result.add(m);
    }
  }
  for (const product of KORVA_PRODUCTS) {
    if (overrides[product] === false) {
      for (const m of PRODUCT_MODULES[product]) {
        const stillGrantedElsewhere = KORVA_PRODUCTS.some(
          (other) =>
            other !== product &&
            overrides[other] !== false &&
            PRODUCT_MODULES[other].includes(m) &&
            (overrides[other] === true || planModules.includes(m)),
        );
        if (!stillGrantedElsewhere) result.delete(m);
      }
    }
  }
  return Array.from(result);
}
