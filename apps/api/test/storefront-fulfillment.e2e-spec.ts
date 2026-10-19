import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

/**
 * How a storefront order is received: delivery (by zone), pickup, dine-in. Standalone file, two
 * registrations, to stay clear of other files' AUTH_THROTTLE budget.
 */

interface ApiSuccess<T> {
  success: true;
  data: T;
}
interface ApiError {
  success: false;
  error: { code: string; message: string };
}
interface OrderPayload {
  id: string;
  number: string;
  total: number;
  shippingCost: number;
  fulfillmentMode?: string;
  deliveryZoneName?: string;
  requestedFor?: string;
  tableLabel?: string;
  shippingAddress?: unknown;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

const ADDRESS = {
  line1: '12 rue des Jardins',
  city: 'Abidjan',
  postalCode: '00225',
  country: 'CI',
};

/** Tomorrow's date as YYYY-MM-DD in Abidjan (UTC+0 all year). */
function tomorrow(): string {
  return new Date(Date.now() + 24 * 3_600_000).toISOString().slice(0, 10);
}

describe('Storefront fulfillment (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    server = app.getHttpServer();
    connection = app.get(getConnectionToken());
    await connection.dropDatabase();
    await Promise.all(
      connection
        .modelNames()
        .map((name) => connection.model(name).syncIndexes()),
    );
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  async function setupShop(email: string, settings: Record<string, unknown>) {
    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    const accessToken = asSuccess<{ accessToken: string }>(
      authRes.body,
    ).accessToken;
    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: `Shop ${email}`,
        type: 'restauration',
        country: 'CI',
        currency: 'XOF',
        timezone: 'Africa/Abidjan',
        language: 'fr',
      })
      .expect(201);
    const { id: organizationId, slug } = asSuccess<{
      id: string;
      slug: string;
    }>(orgRes.body);
    const auth = (req: request.Test) =>
      req
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId);

    await auth(request(server).patch('/api/v1/organizations/me'))
      .send({
        enabledModules: ['catalog', 'commerce', 'crm', 'website'],
        ...settings,
      })
      .expect(200);

    const offer = async (status: string) =>
      asSuccess<{ id: string }>(
        (
          await auth(request(server).post('/api/v1/offers'))
            .send({
              type: 'product',
              name: `Garba ${status}`,
              status,
              pricing: { amount: 2500, currency: 'XOF' },
            })
            .expect(201)
        ).body,
      ).id;

    return {
      slug,
      auth,
      activeOfferId: await offer('active'),
      draftOfferId: await offer('draft'),
    };
  }

  function placeOrder(slug: string, body: Record<string, unknown>) {
    return request(server)
      .post(`/api/v1/public/${slug}/orders`)
      .send({
        currency: 'XOF',
        contact: { email: 'client@test.ci', firstName: 'Kofi' },
        ...body,
      });
  }

  describe('with modes and zones configured', () => {
    let shop: Awaited<ReturnType<typeof setupShop>>;

    beforeAll(async () => {
      shop = await setupShop('fulfillment-configured@korva.test', {
        shippingFlatRate: 2000,
        fulfillmentModes: ['delivery', 'pickup', 'dine_in'],
        deliveryZones: [
          { id: 'cocody', name: 'Cocody', fee: 1000, minimumOrder: 5000 },
          { id: 'plateau', name: 'Plateau', fee: 1500 },
        ],
        pickupInstructions: 'Comptoir à gauche',
        orderLeadTimeMinutes: 30,
      });
    });

    it('exposes the modes, zones and pickup instructions publicly', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${shop.slug}`)
        .expect(200);
      const site = asSuccess<{
        fulfillmentModes: string[];
        deliveryZones: { name: string }[];
        pickupInstructions: string;
      }>(res.body);
      expect(site.fulfillmentModes).toEqual(['delivery', 'pickup', 'dine_in']);
      expect(site.deliveryZones.map((zone) => zone.name)).toEqual([
        'Cocody',
        'Plateau',
      ]);
      expect(site.pickupInstructions).toBe('Comptoir à gauche');
    });

    it('charges no delivery fee for pickup, records the requested time, and shows it in the dashboard', async () => {
      const res = await placeOrder(shop.slug, {
        items: [{ offerId: shop.activeOfferId, quantity: 2 }],
        fulfillmentMode: 'pickup',
        requestedFor: { date: tomorrow(), time: '12:30' },
        shippingAddress: ADDRESS,
      }).expect(201);
      const { id } = asSuccess<{ id: string }>(res.body);

      const order = asSuccess<OrderPayload>(
        (
          await shop
            .auth(request(server).get(`/api/v1/orders/${id}`))
            .expect(200)
        ).body,
      );
      expect(order.shippingCost).toBe(0);
      expect(order.total).toBe(5000);
      expect(order.fulfillmentMode).toBe('pickup');
      expect(order.shippingAddress).toBeUndefined();
      expect(order.requestedFor).toBe(`${tomorrow()}T12:30:00.000Z`);
    });

    it("charges the zone's fee for delivery and enforces its minimum basket", async () => {
      const below = await placeOrder(shop.slug, {
        items: [{ offerId: shop.activeOfferId, quantity: 1 }],
        fulfillmentMode: 'delivery',
        deliveryZoneId: 'cocody',
        shippingAddress: ADDRESS,
      }).expect(400);
      expect(asError(below.body).code).toBe('BELOW_MINIMUM_ORDER');

      const res = await placeOrder(shop.slug, {
        items: [{ offerId: shop.activeOfferId, quantity: 2 }],
        fulfillmentMode: 'delivery',
        deliveryZoneId: 'cocody',
        shippingAddress: ADDRESS,
      }).expect(201);
      const { id } = asSuccess<{ id: string }>(res.body);
      const order = asSuccess<OrderPayload>(
        (
          await shop
            .auth(request(server).get(`/api/v1/orders/${id}`))
            .expect(200)
        ).body,
      );
      expect(order.shippingCost).toBe(1000);
      expect(order.total).toBe(6000);
      expect(order.deliveryZoneName).toBe('Cocody');
    });

    it('requires a mode, refuses a time inside the preparation delay, and refuses a draft offer', async () => {
      const noMode = await placeOrder(shop.slug, {
        items: [{ offerId: shop.activeOfferId, quantity: 1 }],
      }).expect(400);
      expect(asError(noMode.body).code).toBe('FULFILLMENT_MODE_REQUIRED');

      const now = new Date();
      const tooSoon = await placeOrder(shop.slug, {
        items: [{ offerId: shop.activeOfferId, quantity: 1 }],
        fulfillmentMode: 'pickup',
        requestedFor: {
          date: now.toISOString().slice(0, 10),
          time: now.toISOString().slice(11, 16),
        },
      }).expect(400);
      expect(asError(tooSoon.body).code).toBe('REQUESTED_TIME_UNAVAILABLE');

      const draft = await placeOrder(shop.slug, {
        items: [{ offerId: shop.draftOfferId, quantity: 1 }],
        fulfillmentMode: 'pickup',
      }).expect(404);
      expect(asError(draft.body).code).toBe('OFFER_NOT_FOUND');
    });
  });

  it('prices dish options from the stored offer, names them on the order line, and enforces required choices', async () => {
    const shop = await setupShop('fulfillment-options@korva.test', {
      fulfillmentModes: ['pickup'],
    });
    const invalidGroup = await shop
      .auth(request(server).post('/api/v1/offers'))
      .send({
        type: 'product',
        name: 'Invalide',
        status: 'active',
        pricing: { amount: 1000, currency: 'XOF' },
        optionGroups: [
          {
            id: 'g',
            name: 'Taille',
            required: true,
            maxChoices: 3,
            options: [{ id: 'a', name: 'A', priceDelta: 0 }],
          },
        ],
      });
    expect(invalidGroup.status).toBe(400);

    const offerRes = await shop
      .auth(request(server).post('/api/v1/offers'))
      .send({
        type: 'product',
        name: 'Garba',
        status: 'active',
        pricing: { amount: 2500, currency: 'XOF' },
        optionGroups: [
          {
            id: 'size',
            name: 'Taille',
            required: true,
            maxChoices: 1,
            options: [
              { id: 'small', name: 'Petit', priceDelta: 0 },
              { id: 'large', name: 'Grand', priceDelta: 500 },
            ],
          },
          {
            id: 'extras',
            name: 'Suppléments',
            required: false,
            maxChoices: 2,
            options: [
              { id: 'egg', name: 'Œuf', priceDelta: 200 },
              { id: 'chili', name: 'Piment', priceDelta: 0 },
            ],
          },
        ],
      })
      .expect(201);
    const garbaId = asSuccess<{ id: string }>(offerRes.body).id;

    const publicOffer = asSuccess<{ optionGroups?: unknown[] }>(
      (
        await request(server)
          .get(`/api/v1/public/${shop.slug}/offers/${garbaId}`)
          .expect(200)
      ).body,
    );
    expect(publicOffer.optionGroups).toHaveLength(2);

    const missing = await placeOrder(shop.slug, {
      items: [{ offerId: garbaId, quantity: 1 }],
      fulfillmentMode: 'pickup',
    }).expect(400);
    expect(asError(missing.body).code).toBe('INVALID_OFFER_OPTIONS');

    const res = await placeOrder(shop.slug, {
      items: [{ offerId: garbaId, quantity: 2, optionIds: ['large', 'egg'] }],
      fulfillmentMode: 'pickup',
    }).expect(201);
    const { id } = asSuccess<{ id: string }>(res.body);
    const order = asSuccess<{
      total: number;
      items: { description: string; unitPrice: number }[];
    }>(
      (await shop.auth(request(server).get(`/api/v1/orders/${id}`)).expect(200))
        .body,
    );
    expect(order.items[0]).toMatchObject({
      description: 'Garba (Grand, Œuf)',
      unitPrice: 3200,
    });
    expect(order.total).toBe(6400);
  });

  it('keeps the flat rate on every order for a shop that configured no mode', async () => {
    const shop = await setupShop('fulfillment-legacy@korva.test', {
      shippingFlatRate: 2000,
    });
    const res = await placeOrder(shop.slug, {
      items: [{ offerId: shop.activeOfferId, quantity: 1 }],
      // Ignored: this shop offers no modes.
      fulfillmentMode: 'pickup',
    }).expect(201);
    const { id } = asSuccess<{ id: string }>(res.body);
    const order = asSuccess<OrderPayload>(
      (await shop.auth(request(server).get(`/api/v1/orders/${id}`)).expect(200))
        .body,
    );
    expect(order.shippingCost).toBe(2000);
    expect(order.fulfillmentMode).toBeUndefined();
  });
});
