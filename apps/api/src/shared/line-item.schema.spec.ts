import { computeTotals } from './line-item.schema';

describe('computeTotals', () => {
  it('computes subtotal, tax and total for a single line without tax', () => {
    const totals = computeTotals([
      { description: 'Widget', quantity: 2, unitPrice: 10 },
    ]);
    expect(totals).toEqual({ subtotal: 20, taxTotal: 0, total: 20 });
  });

  it('applies a per-line tax rate as a percentage', () => {
    const totals = computeTotals([
      { description: 'Widget', quantity: 1, unitPrice: 100, taxRate: 20 },
    ]);
    expect(totals).toEqual({ subtotal: 100, taxTotal: 20, total: 120 });
  });

  it('sums multiple lines with different tax rates independently', () => {
    const totals = computeTotals([
      { description: 'A', quantity: 1, unitPrice: 100, taxRate: 20 },
      { description: 'B', quantity: 2, unitPrice: 50, taxRate: 0 },
    ]);
    expect(totals).toEqual({ subtotal: 200, taxTotal: 20, total: 220 });
  });

  it('rounds to two decimal places', () => {
    const totals = computeTotals([
      { description: 'A', quantity: 3, unitPrice: 10.005 },
    ]);
    expect(totals.subtotal).toBe(30.02);
  });

  it('returns zero totals for an empty item list', () => {
    expect(computeTotals([])).toEqual({ subtotal: 0, taxTotal: 0, total: 0 });
  });
});
