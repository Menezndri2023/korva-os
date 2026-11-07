import { saleCostsInSaleCurrency } from './provider-fees';

describe('saleCostsInSaleCurrency', () => {
  it('keeps the fee as is when the provider charged in the sale currency', () => {
    expect(
      saleCostsInSaleCurrency(
        { amount: 10_000, currency: 'XOF' },
        { providerFee: 350, providerAmount: 10_000, providerCurrency: 'XOF' },
      ),
    ).toEqual({ fee: 350, conversion: 0 });
  });

  it('books the real 1 EUR Wave sale of 2026-11-02 at what KORVA received', () => {
    // GeniusPay: amount 610.7 XOF, fees 115.28 XOF, net 495.42 XOF.
    const costs = saleCostsInSaleCurrency(
      { amount: 1, currency: 'EUR' },
      { providerFee: 115.28, providerAmount: 610.7, providerCurrency: 'XOF' },
    );
    expect(costs.fee).toBe(0.18);
    expect(costs.conversion).toBe(0.07);
    // Credited ≈ 495.42 XOF at the legal parity — never the −114 EUR booked before.
    expect(1 - costs.fee! - costs.conversion).toBeCloseTo(495.42 / 655.957, 1);
  });

  it('converts at the provider rate when no fixed parity exists', () => {
    expect(
      saleCostsInSaleCurrency(
        { amount: 10, currency: 'USD' },
        { providerFee: 161, providerAmount: 6100, providerCurrency: 'XOF' },
      ),
    ).toMatchObject({ fee: 0.26, conversion: 0 });
  });

  it('never credits a gain when the provider rate favours the business', () => {
    expect(
      saleCostsInSaleCurrency(
        { amount: 1, currency: 'EUR' },
        { providerFee: 100, providerAmount: 700, providerCurrency: 'XOF' },
      ).conversion,
    ).toBe(0);
  });

  it('reports the conversion even when the fee is unknown', () => {
    expect(
      saleCostsInSaleCurrency(
        { amount: 10, currency: 'EUR' },
        { providerAmount: 6107, providerCurrency: 'XOF' },
      ),
    ).toMatchObject({ fee: undefined, conversion: 0.69 });
  });
});
