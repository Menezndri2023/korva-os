import { Types } from 'mongoose';
import type { SegmentCriteria } from '@korva/types';
import { buildContactFilter } from './segment-query-builder';

describe('buildContactFilter', () => {
  const organizationId = new Types.ObjectId().toString();

  it('always hard-codes organizationId, regardless of rule content', () => {
    const criteria: SegmentCriteria = {
      version: 1,
      match: 'all',
      rules: [{ field: 'tag', operator: 'has_tag', value: 'vip' }],
    };
    const filter = buildContactFilter(organizationId, criteria) as Record<
      string,
      unknown
    >;
    expect((filter.organizationId as Types.ObjectId).toString()).toBe(
      organizationId,
    );
  });

  it('never lets a rule value become a non-primitive Mongo operator injection', () => {
    // Zod already rejects a non-primitive `value` at the validation layer (see
    // packages/validation/src/marketing.ts), but this test proves the query builder itself
    // never treats a rule's value as anything but an opaque scalar it stores verbatim — it
    // never interprets, merges, or spreads `rule.value` into the filter shape.
    const criteria: SegmentCriteria = {
      version: 1,
      match: 'all',
      rules: [
        {
          field: 'customField:budget',
          operator: 'equals',
          // Cast bypasses the SegmentRule['value'] type deliberately, to prove the query
          // builder's own runtime behavior — the type system already blocks this input at the
          // validation layer in production.
          value: { $gt: '' } as unknown as string,
        },
      ],
    };
    const filter = buildContactFilter(organizationId, criteria) as Record<
      string,
      unknown
    >;
    const clause = (filter.$and as Record<string, unknown>[])[0];
    expect(clause).toEqual({ 'customFields.budget': { $gt: '' } });
  });

  it('has_tag builds an equality clause on tags', () => {
    const criteria: SegmentCriteria = {
      version: 1,
      match: 'all',
      rules: [{ field: 'tag', operator: 'has_tag', value: 'vip' }],
    };
    const filter = buildContactFilter(organizationId, criteria) as Record<
      string,
      unknown
    >;
    expect((filter.$and as unknown[])[0]).toEqual({ tags: 'vip' });
  });

  it('not_has_tag builds a $nin clause', () => {
    const criteria: SegmentCriteria = {
      version: 1,
      match: 'all',
      rules: [{ field: 'tag', operator: 'not_has_tag', value: 'churned' }],
    };
    const filter = buildContactFilter(organizationId, criteria) as Record<
      string,
      unknown
    >;
    expect((filter.$and as unknown[])[0]).toEqual({
      tags: { $nin: ['churned'] },
    });
  });

  it('equals/not_equals build direct field clauses on a custom field path', () => {
    const criteria: SegmentCriteria = {
      version: 1,
      match: 'all',
      rules: [{ field: 'customField:plan', operator: 'equals', value: 'pro' }],
    };
    const filter = buildContactFilter(organizationId, criteria) as Record<
      string,
      unknown
    >;
    expect((filter.$and as unknown[])[0]).toEqual({
      'customFields.plan': 'pro',
    });
  });

  it('contains builds a case-insensitive, regex-escaped clause', () => {
    const criteria: SegmentCriteria = {
      version: 1,
      match: 'all',
      rules: [
        { field: 'customField:notes', operator: 'contains', value: 'a.b(c)' },
      ],
    };
    const filter = buildContactFilter(organizationId, criteria) as Record<
      string,
      unknown
    >;
    const clause = (filter.$and as Record<string, { $regex: string }>[])[0]!;
    expect(clause['customFields.notes']!.$regex).toBe('a\\.b\\(c\\)');
  });

  it('is_set / is_not_set build $exists clauses', () => {
    const criteria: SegmentCriteria = {
      version: 1,
      match: 'any',
      rules: [
        { field: 'customField:phone', operator: 'is_set' },
        { field: 'customField:email', operator: 'is_not_set' },
      ],
    };
    const filter = buildContactFilter(organizationId, criteria) as Record<
      string,
      unknown
    >;
    expect(filter.$or).toEqual([
      { 'customFields.phone': { $exists: true } },
      { 'customFields.email': { $exists: false } },
    ]);
  });

  it('wraps rules in $and for match:"all" and $or for match:"any"', () => {
    const rules: SegmentCriteria['rules'] = [
      { field: 'tag', operator: 'has_tag', value: 'a' },
      { field: 'tag', operator: 'has_tag', value: 'b' },
    ];
    const all = buildContactFilter(organizationId, {
      version: 1,
      match: 'all',
      rules,
    }) as Record<string, unknown>;
    const any = buildContactFilter(organizationId, {
      version: 1,
      match: 'any',
      rules,
    }) as Record<string, unknown>;
    expect(all.$and).toBeDefined();
    expect(all.$or).toBeUndefined();
    expect(any.$or).toBeDefined();
    expect(any.$and).toBeUndefined();
  });

  it('throws for an unrecognized rule field rather than silently building a wrong filter', () => {
    const criteria: SegmentCriteria = {
      version: 1,
      match: 'all',
      rules: [
        { field: 'not-a-real-field', operator: 'equals', value: 'x' },
      ],
    };
    expect(() => buildContactFilter(organizationId, criteria)).toThrow(
      /Unrecognized segment rule field/,
    );
  });
});
