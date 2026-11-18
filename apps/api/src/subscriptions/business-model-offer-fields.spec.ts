import { BUSINESS_MODELS, BUSINESS_MODEL_OFFER_FIELDS } from '@korva/types';

/**
 * Coherence rules for the guided offer characteristics (@korva/types business-models.ts).
 * Lives here for the same reason as vertical-templates.spec.ts: packages/types has no runner.
 *
 * Each field's label is also the Offer.attributes key the storefront prints, so two fields with
 * one label would silently overwrite each other, and a select with no options renders an empty
 * dropdown the owner cannot use.
 */
describe('BUSINESS_MODEL_OFFER_FIELDS', () => {
  const entries = Object.entries(BUSINESS_MODEL_OFFER_FIELDS);

  it('guides every type of activity except retail, whose products no list could usefully guess', () => {
    const guided = new Set(Object.keys(BUSINESS_MODEL_OFFER_FIELDS));
    expect(BUSINESS_MODELS.filter((model) => !guided.has(model))).toEqual([
      'retail',
    ]);
  });

  it.each(entries)(
    '%s: labels are unique, so no field overwrites another',
    (_model, fields) => {
      const labels = fields.map((field) => field.label);
      expect(new Set(labels).size).toBe(labels.length);
    },
  );

  it.each(entries)(
    '%s: every select and checklist offers at least two choices',
    (_model, fields) => {
      for (const field of fields) {
        if (field.kind === 'select' || field.kind === 'checklist') {
          expect(field.options?.length ?? 0).toBeGreaterThanOrEqual(2);
          expect(new Set(field.options).size).toBe(field.options!.length);
        }
      }
    },
  );

  it.each(entries)(
    '%s: no option contains ", " — a checklist is stored joined by it and read back split on it',
    (_model, fields) => {
      for (const field of fields) {
        for (const option of field.options ?? [])
          expect(option).not.toContain(', ');
      }
    },
  );
});
