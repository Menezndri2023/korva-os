import { BadRequestException } from '@nestjs/common';
import type { CreatePublicOrderInput } from '@korva/validation';
import { resolveStorefrontFulfillment } from './storefront-fulfillment';

const ADDRESS = {
  line1: '12 rue des Jardins',
  city: 'Abidjan',
  postalCode: '00225',
  country: 'CI',
};

function order(
  extra: Partial<CreatePublicOrderInput> = {},
): CreatePublicOrderInput {
  return {
    items: [{ offerId: 'offer-1', quantity: 1 }],
    currency: 'XOF',
    contact: { email: 'client@test.ci' },
    ...extra,
  };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof BadRequestException) {
      return (error.getResponse() as { code: string }).code;
    }
    throw error;
  }
  return undefined;
}

const ZONES = [
  { id: 'cocody', name: 'Cocody', fee: 1000, minimumOrder: 5000 },
  { id: 'plateau', name: 'Plateau', fee: 1500 },
];

const configured = {
  fulfillmentModes: ['delivery', 'pickup', 'dine_in'] as const,
  deliveryZones: ZONES,
  shippingFlatRate: 2000,
  orderLeadTimeMinutes: 30,
  timezone: 'Africa/Abidjan',
};
const NOW = new Date('2026-07-06T10:00:00.000Z');

describe('resolveStorefrontFulfillment', () => {
  it('keeps the legacy behaviour for an organization that configured no mode', () => {
    const result = resolveStorefrontFulfillment(
      { shippingFlatRate: 3, timezone: 'Europe/Paris' },
      order({ fulfillmentMode: 'pickup', shippingAddress: ADDRESS }),
      10,
    );
    expect(result).toEqual({ shippingCost: 3, shippingAddress: ADDRESS });
  });

  it('charges nothing for pickup and dine-in, and keeps no address', () => {
    const pickup = resolveStorefrontFulfillment(
      { ...configured, fulfillmentModes: [...configured.fulfillmentModes] },
      order({ fulfillmentMode: 'pickup', shippingAddress: ADDRESS }),
      10_000,
      NOW,
    );
    expect(pickup).toEqual({ shippingCost: 0, fulfillmentMode: 'pickup' });

    const dineIn = resolveStorefrontFulfillment(
      { ...configured, fulfillmentModes: [...configured.fulfillmentModes] },
      order({ fulfillmentMode: 'dine_in', tableLabel: ' Table 4 ' }),
      10_000,
      NOW,
    );
    expect(dineIn).toEqual({
      shippingCost: 0,
      fulfillmentMode: 'dine_in',
      tableLabel: 'Table 4',
    });
  });

  it("charges the chosen zone's fee instead of the flat rate", () => {
    const result = resolveStorefrontFulfillment(
      { ...configured, fulfillmentModes: [...configured.fulfillmentModes] },
      order({
        fulfillmentMode: 'delivery',
        deliveryZoneId: 'plateau',
        shippingAddress: ADDRESS,
      }),
      1000,
      NOW,
    );
    expect(result).toMatchObject({
      shippingCost: 1500,
      deliveryZoneName: 'Plateau',
      shippingAddress: ADDRESS,
    });
  });

  it('refuses a mode the business does not offer, a missing address or zone, and a basket under the minimum', () => {
    const pickupOnly = { ...configured, fulfillmentModes: ['pickup' as const] };
    const all = {
      ...configured,
      fulfillmentModes: [...configured.fulfillmentModes],
    };

    expect(
      codeOf(() =>
        resolveStorefrontFulfillment(
          pickupOnly,
          order({ fulfillmentMode: 'delivery' }),
          1,
          NOW,
        ),
      ),
    ).toBe('FULFILLMENT_MODE_REQUIRED');
    expect(
      codeOf(() => resolveStorefrontFulfillment(all, order(), 1, NOW)),
    ).toBe('FULFILLMENT_MODE_REQUIRED');
    expect(
      codeOf(() =>
        resolveStorefrontFulfillment(
          all,
          order({ fulfillmentMode: 'delivery', deliveryZoneId: 'plateau' }),
          1,
          NOW,
        ),
      ),
    ).toBe('DELIVERY_ADDRESS_REQUIRED');
    expect(
      codeOf(() =>
        resolveStorefrontFulfillment(
          all,
          order({ fulfillmentMode: 'delivery', shippingAddress: ADDRESS }),
          1,
          NOW,
        ),
      ),
    ).toBe('DELIVERY_ZONE_REQUIRED');
    expect(
      codeOf(() =>
        resolveStorefrontFulfillment(
          all,
          order({
            fulfillmentMode: 'delivery',
            deliveryZoneId: 'cocody',
            shippingAddress: ADDRESS,
          }),
          4999,
          NOW,
        ),
      ),
    ).toBe('BELOW_MINIMUM_ORDER');
  });

  it("converts the requested time in the business's timezone and enforces the lead time", () => {
    const paris = {
      ...configured,
      fulfillmentModes: ['pickup' as const],
      timezone: 'Europe/Paris',
    };
    // 14:00 in Paris in July is 12:00 UTC.
    const ok = resolveStorefrontFulfillment(
      paris,
      order({
        fulfillmentMode: 'pickup',
        requestedFor: { date: '2026-07-06', time: '14:00' },
      }),
      1,
      NOW,
    );
    expect(ok.requestedFor?.toISOString()).toBe('2026-07-06T12:00:00.000Z');

    // 12:20 Paris = 10:20 UTC: only 20 minutes after NOW, under the 30-minute lead time.
    expect(
      codeOf(() =>
        resolveStorefrontFulfillment(
          paris,
          order({
            fulfillmentMode: 'pickup',
            requestedFor: { date: '2026-07-06', time: '12:20' },
          }),
          1,
          NOW,
        ),
      ),
    ).toBe('REQUESTED_TIME_UNAVAILABLE');
    expect(
      codeOf(() =>
        resolveStorefrontFulfillment(
          paris,
          order({
            fulfillmentMode: 'pickup',
            requestedFor: { date: '2026-09-01', time: '12:00' },
          }),
          1,
          NOW,
        ),
      ),
    ).toBe('REQUESTED_TIME_UNAVAILABLE');
  });
});
