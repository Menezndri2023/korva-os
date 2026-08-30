import { computeTotals } from './line-item.schema';

describe('computeTotals', () => {
  it('computes subtotal, tax and total for a single line without tax', () => {
    const totals = computeTotals([
      { description: 'Widget', quantity: 2, unitPrice: 10 },
    ]);
    expect(totals).toEqual({
      subtotal: 20,
      taxTotal: 0,
      discountTotal: 0,
      total: 20,
    });
  });

  it('applies a per-line tax rate as a percentage', () => {
    const totals = computeTotals([
      { description: 'Widget', quantity: 1, unitPrice: 100, taxRate: 20 },
    ]);
    expect(totals).toEqual({
      subtotal: 100,
      taxTotal: 20,
      discountTotal: 0,
      total: 120,
    });
  });

  it('sums multiple lines with different tax rates independently', () => {
    const totals = computeTotals([
      { description: 'A', quantity: 1, unitPrice: 100, taxRate: 20 },
      { description: 'B', quantity: 2, unitPrice: 50, taxRate: 0 },
    ]);
    expect(totals).toEqual({
      subtotal: 200,
      taxTotal: 20,
      discountTotal: 0,
      total: 220,
    });
  });

  it('rounds to two decimal places', () => {
    const totals = computeTotals([
      { description: 'A', quantity: 3, unitPrice: 10.005 },
    ]);
    expect(totals.subtotal).toBe(30.02);
  });

  it('returns zero totals for an empty item list', () => {
    expect(computeTotals([])).toEqual({
      subtotal: 0,
      taxTotal: 0,
      discountTotal: 0,
      total: 0,
    });
  });

  it('applies a percentage discount against the pre-tax subtotal, not the post-tax total', () => {
    const totals = computeTotals(
      [{ description: 'Widget', quantity: 1, unitPrice: 100, taxRate: 20 }],
      { type: 'percentage', value: 10 },
    );
    // subtotal 100, tax 20, discount = 10% of 100 = 10, total = 100+20-10 = 110
    expect(totals).toEqual({
      subtotal: 100,
      taxTotal: 20,
      discountTotal: 10,
      total: 110,
    });
  });

  it('applies a fixed-amount discount', () => {
    const totals = computeTotals(
      [{ description: 'Widget', quantity: 1, unitPrice: 100 }],
      { type: 'fixed', value: 15 },
    );
    expect(totals).toEqual({
      subtotal: 100,
      taxTotal: 0,
      discountTotal: 15,
      total: 85,
    });
  });

  it('clamps a fixed discount larger than the order so the total never goes negative', () => {
    const totals = computeTotals(
      [{ description: 'Widget', quantity: 1, unitPrice: 10 }],
      { type: 'fixed', value: 1000 },
    );
    expect(totals).toEqual({
      subtotal: 10,
      taxTotal: 0,
      discountTotal: 10,
      total: 0,
    });
  });
});
