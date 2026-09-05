import {
  KORVA_MODULES,
  KORVA_PRODUCTS,
  PRODUCT_MODULES,
  resolveEffectiveModules,
  type KorvaModule,
} from '@korva/types';

describe('resolveEffectiveModules', () => {
  it('returns the plan modules unchanged when there are no overrides at all', () => {
    const planModules: KorvaModule[] = ['crm', 'catalog', 'finance'];
    expect(resolveEffectiveModules(planModules)).toEqual(
      expect.arrayContaining(planModules),
    );
    expect(resolveEffectiveModules(planModules)).toHaveLength(
      planModules.length,
    );
  });

  it('returns the plan modules unchanged when overrides is an empty object', () => {
    const planModules: KorvaModule[] = ['crm', 'ai'];
    expect(new Set(resolveEffectiveModules(planModules, {}))).toEqual(
      new Set(planModules),
    );
  });

  it('a false override strips a cross-cutting module only if no other active product still grants it', () => {
    // "starter"-shaped plan: everything except workflow/ai, including finance (shared by crm
    // and inventory) and catalog/commerce (inventory-only).
    const planModules: KorvaModule[] = [
      'crm',
      'catalog',
      'booking',
      'commerce',
      'finance',
      'communication',
      'analytics',
    ];
    const effective = resolveEffectiveModules(planModules, {
      inventory: false,
    });
    // catalog/commerce belong only to inventory in PRODUCT_MODULES -> stripped.
    expect(effective).not.toContain('catalog');
    expect(effective).not.toContain('commerce');
    // finance is shared with crm, which was never overridden false -> survives.
    expect(effective).toContain('finance');
    // untouched modules are unaffected.
    expect(effective).toContain('crm');
    expect(effective).toContain('booking');
  });

  it('a true override force-grants a product even beyond what the plan includes', () => {
    const planModules: KorvaModule[] = ['crm']; // deliberately excludes ai
    const effective = resolveEffectiveModules(planModules, { ai: true });
    expect(effective).toContain('ai');
    expect(effective).toContain('crm');
  });

  it('is order-independent between a true and a false override touching a shared module', () => {
    // finance is not in the base plan at all; crm:true should still grant it even though
    // inventory:false is also set (and evaluated in the same pass).
    const effective = resolveEffectiveModules([], {
      crm: true,
      inventory: false,
    });
    expect(effective).toContain('finance');
    expect(effective).not.toContain('catalog');
    expect(effective).not.toContain('commerce');
  });

  it('never removes a module the plan grants directly when no override touches it', () => {
    const planModules: KorvaModule[] = ['ai'];
    expect(resolveEffectiveModules(planModules, { crm: false })).toContain(
      'ai',
    );
  });

  it('covers every KorvaModule in at least one product — otherwise a false override could never fully strip it', () => {
    for (const module of KORVA_MODULES) {
      expect(
        KORVA_PRODUCTS.some((product) =>
          PRODUCT_MODULES[product].includes(module),
        ),
      ).toBe(true);
    }
  });
});
