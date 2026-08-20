import { evaluateConditions } from './conditions';

describe('evaluateConditions', () => {
  it('matches everything when there are no conditions', () => {
    expect(evaluateConditions([], {})).toBe(true);
  });

  it('resolves a dot-path field into nested payload objects', () => {
    const matched = evaluateConditions(
      [{ field: 'contact.email', operator: 'equals', value: 'a@b.com' }],
      { contact: { email: 'a@b.com' } },
    );
    expect(matched).toBe(true);
  });

  it('returns false when a dot-path segment does not exist', () => {
    const matched = evaluateConditions(
      [{ field: 'contact.email', operator: 'equals', value: 'a@b.com' }],
      { contact: {} },
    );
    expect(matched).toBe(false);
  });

  it('requires all conditions to pass (AND)', () => {
    const conditions = [
      { field: 'amount', operator: 'greater_than' as const, value: 100 },
      { field: 'status', operator: 'equals' as const, value: 'open' },
    ];
    expect(
      evaluateConditions(conditions, { amount: 200, status: 'open' }),
    ).toBe(true);
    expect(
      evaluateConditions(conditions, { amount: 200, status: 'closed' }),
    ).toBe(false);
  });

  it('never matches greater_than/less_than when either side is not a number', () => {
    expect(
      evaluateConditions(
        [{ field: 'amount', operator: 'greater_than', value: 100 }],
        { amount: '200' },
      ),
    ).toBe(false);
  });

  it('matches contains on a substring', () => {
    expect(
      evaluateConditions(
        [{ field: 'title', operator: 'contains', value: 'urgent' }],
        { title: 'This is urgent' },
      ),
    ).toBe(true);
  });

  it('matches contains on an array element', () => {
    expect(
      evaluateConditions(
        [{ field: 'tags', operator: 'contains', value: 'vip' }],
        { tags: ['new', 'vip'] },
      ),
    ).toBe(true);
  });

  it('matches not_equals', () => {
    expect(
      evaluateConditions(
        [{ field: 'status', operator: 'not_equals', value: 'closed' }],
        {
          status: 'open',
        },
      ),
    ).toBe(true);
  });
});
