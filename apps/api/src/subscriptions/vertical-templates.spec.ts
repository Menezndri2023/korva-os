import {
  KORVA_MODULES,
  MODULE_MIN_PLAN,
  STOREFRONT_TEMPLATE_KEYS,
  VERTICAL_TEMPLATES,
  getStorefrontTemplate,
  modulesForPlan,
} from '@korva/types';

/**
 * Coherence rules for the onboarding vertical catalog (@korva/types verticals.ts).
 *
 * Lives in apps/api because that is where this monorepo's Jest setup is — `packages/types` has
 * no test runner of its own, and the API genuinely consumes VERTICAL_TEMPLATES too (see
 * PublicService#resolveStorefrontTheme). The rules are about MODULE COMBINATIONS, which types
 * cannot express: TypeScript checks that `"website"` is a real KorvaModule, not that a template
 * naming a storefront template also enables the module that renders it.
 *
 * Every assertion here corresponds to a real defect found on 2026-10-12, not a hypothetical:
 * all 17 templates omitted "website" and "marketing", and 5 suggested "booking" with no
 * channel to send a reminder through.
 */
describe('VERTICAL_TEMPLATES coherence', () => {
  it('ships a non-trivial catalog with unique keys', () => {
    expect(VERTICAL_TEMPLATES.length).toBeGreaterThanOrEqual(17);
    const keys = VERTICAL_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('fills every displayed field — an empty label or description reaches the onboarding UI verbatim', () => {
    for (const t of VERTICAL_TEMPLATES) {
      expect(t.label.trim()).not.toBe('');
      expect(t.description.trim()).not.toBe('');
      expect(t.suggestedType.trim()).not.toBe('');
      expect(t.suggestedModules.length).toBeGreaterThan(0);
    }
  });

  it('references only real modules and a real storefront template', () => {
    for (const t of VERTICAL_TEMPLATES) {
      expect(STOREFRONT_TEMPLATE_KEYS).toContain(t.defaultStorefrontTemplate);
      for (const m of t.suggestedModules) {
        expect(KORVA_MODULES).toContain(m);
      }
      // Duplicates would be submitted as-is to PATCH /organizations/me.
      expect(new Set(t.suggestedModules).size).toBe(t.suggestedModules.length);
    }
  });

  it("suggests 'website' everywhere, since every template also names a defaultStorefrontTemplate", () => {
    // Not cosmetic: onboarding PATCHes suggestedModules over the full module set that
    // POST /organizations already granted, so a template omitting 'website' REMOVES the
    // storefront from a freshly created organization.
    const missing = VERTICAL_TEMPLATES.filter(
      (t) => !t.suggestedModules.includes('website'),
    ).map((t) => t.key);
    expect(missing).toEqual([]);
  });

  it("pairs 'booking' with 'communication', or booking reminders have no channel", () => {
    const missing = VERTICAL_TEMPLATES.filter(
      (t) =>
        t.suggestedModules.includes('booking') &&
        !t.suggestedModules.includes('communication'),
    ).map((t) => t.key);
    expect(missing).toEqual([]);
  });

  it("pairs 'marketing' with 'communication', or a Campaign has nowhere to send", () => {
    const missing = VERTICAL_TEMPLATES.filter(
      (t) =>
        t.suggestedModules.includes('marketing') &&
        !t.suggestedModules.includes('communication'),
    ).map((t) => t.key);
    expect(missing).toEqual([]);
  });

  it("suggests the module that owns a starter workflow's trigger, or the workflow never fires", () => {
    // nonprofit_association shipped a "Nouvelle adhésion" workflow triggered by order.created
    // while suggesting no commerce module — created successfully, then permanently silent.
    const TRIGGER_OWNER: Record<string, string> = {
      'booking.created': 'booking',
      'order.created': 'commerce',
      'lead.created': 'crm',
    };
    for (const t of VERTICAL_TEMPLATES) {
      const trigger = t.starterWorkflow?.trigger;
      if (!trigger) continue;
      const owner = TRIGGER_OWNER[trigger];
      // A trigger absent from the map is a new one: extend the map rather than skipping it.
      expect(Object.keys(TRIGGER_OWNER)).toContain(trigger);
      expect(t.suggestedModules).toContain(owner);
    }
  });

  it("only attaches a starter workflow to a template that also suggests 'workflow'", () => {
    // Onboarding skips the workflow POST when the module is absent, so a starterWorkflow on a
    // workflow-less template is silently dead configuration.
    const dead = VERTICAL_TEMPLATES.filter(
      (t) => t.starterWorkflow && !t.suggestedModules.includes('workflow'),
    ).map((t) => t.key);
    expect(dead).toEqual([]);
  });
});

/**
 * The same coherence rules, applied to what onboarding ACTUALLY SENDS.
 *
 * The block above checks `suggestedModules` as declared. Since 2026-10-13 onboarding no longer
 * sends that list: every organization is created on the free plan, and PATCH /organizations/me
 * rejects the whole update if it names a module the plan does not grant, so the web form clamps
 * the suggestions to modulesForPlan("free") first. A rule that holds for the declared list and
 * not for the clamped one is a rule guarding something that never happens.
 *
 * This is what couples the commercial ladder to the vertical catalog. Raising a module's
 * threshold in plan-tiers.ts is a one-word edit that can silently empty a vertical's starter
 * configuration — `workflow: "pro"` did exactly that, and the only thing that caught it was the
 * onboarding test suite in apps/web. These assertions make it fail here, next to the data.
 */
describe('VERTICAL_TEMPLATES coherence on the free plan', () => {
  const FREE = modulesForPlan('free');
  const clamped = (modules: readonly string[]) =>
    modules.filter((module) => FREE.includes(module as never));

  it('leaves every template with a starter workflow that is actually created', () => {
    // Onboarding posts the workflow only when `workflow` survived the clamp. A paid `workflow`
    // means all seventeen trades are configured with an automation nobody ever receives.
    const dead = VERTICAL_TEMPLATES.filter(
      (t) =>
        t.starterWorkflow && !clamped(t.suggestedModules).includes('workflow'),
    ).map((t) => t.key);
    expect(dead).toEqual([]);
  });

  it('leaves every starter workflow with a trigger that can still fire', () => {
    // A workflow created with its trigger's module stripped is created and then permanently
    // silent — the same defect nonprofit_association shipped, arriving by a different route.
    const TRIGGER_OWNER: Record<string, string> = {
      'booking.created': 'booking',
      'order.created': 'commerce',
      'lead.created': 'crm',
    };
    for (const t of VERTICAL_TEMPLATES) {
      const trigger = t.starterWorkflow?.trigger;
      if (!trigger) continue;
      expect(clamped(t.suggestedModules)).toContain(TRIGGER_OWNER[trigger]);
    }
  });

  it("leaves 'website' enabled everywhere, so the public page still renders", () => {
    // Every template names a defaultStorefrontTemplate; without `website` the organization has
    // no public page at all and that field is inert.
    for (const t of VERTICAL_TEMPLATES) {
      expect(clamped(t.suggestedModules)).toContain('website');
    }
  });

  it("keeps 'booking' paired with 'communication' after the clamp", () => {
    // BookingReminderSchedulerService has no channel without it. Both are free today, so this
    // passes — it exists to fail the day either threshold moves.
    for (const t of VERTICAL_TEMPLATES) {
      const modules = clamped(t.suggestedModules);
      if (modules.includes('booking')) {
        expect(modules).toContain('communication');
      }
    }
  });

  it('leaves every trade with a usable workspace, not a husk', () => {
    // A trade clamped down to one or two modules is a signup that lands on an empty product.
    // The weakest today keeps 4 of 6 (professional_services, trades_construction, real_estate,
    // digital_agency — each losing only `finance` and `ai`).
    for (const t of VERTICAL_TEMPLATES) {
      expect(clamped(t.suggestedModules).length).toBeGreaterThanOrEqual(4);
    }
  });

  it('gives every trade its own storefront template on the free plan', () => {
    // The inverse of the test that stood here until the sector templates were made free: it
    // recorded that all five carried minPlan "starter", so seventeen trades rendered one
    // identical generic "essentiel" site until someone upgraded. Now each trade's own template
    // must be reachable from free, or defaultStorefrontTemplate is inert again for every new
    // signup (PublicService#resolveStorefrontTheme clamps to what the plan allows).
    const unreachable = VERTICAL_TEMPLATES.filter(
      (t) =>
        getStorefrontTemplate(t.defaultStorefrontTemplate).minPlan !== 'free',
    ).map((t) => t.key);
    expect(unreachable).toEqual([]);
  });

  it('never lets a module be suggested by a trade without existing in the ladder', () => {
    // MODULE_MIN_PLAN is a Record<KorvaModule, PlanKey>, so a missing entry is `undefined`,
    // which planMeetsMinimum ranks as free — silently granting it to everyone.
    for (const t of VERTICAL_TEMPLATES) {
      for (const module of t.suggestedModules) {
        expect(MODULE_MIN_PLAN[module]).toBeDefined();
      }
    }
  });
});
