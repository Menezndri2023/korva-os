import {
  KORVA_MODULES,
  STOREFRONT_TEMPLATE_KEYS,
  VERTICAL_TEMPLATES,
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
