import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

interface ApiSuccess<T> {
  success: true;
  data: T;
}

interface AuthPayload {
  accessToken: string;
}
interface OrganizationPayload {
  id: string;
}
interface ContactPayload {
  id: string;
}
interface OfferPayload {
  id: string;
  stockOnHand?: number;
}
interface TurnoverEntry {
  offerId: string;
  currentStock: number;
  unitsSoldInPeriod: number;
  turnoverRatio: number | null;
}
interface DeadStockEntry {
  offerId: string;
  currentStock: number;
  lastSoldAt: string | null;
}
interface ValuationPayload {
  entries: {
    offerId: string;
    currentStock: number;
    unitCost: number;
    totalValue: number;
  }[];
  totalValue: number;
  currency: string | null;
  unvaluedOfferCount: number;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

/**
 * Own spec file (fresh NestApplication = fresh AUTH_THROTTLE budget) — same established
 * precedent as warehouses.e2e-spec.ts/subscription-product-overrides.e2e-spec.ts, applied
 * proactively this time rather than after hitting a 429.
 */
describe('Inventory analytics (Phase C3, e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let accessToken: string;
  let organizationId: string;
  let contactId: string;
  let soldOfferId: string;
  let deadOfferId: string;
  let unvaluedOfferId: string;

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

    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: 'inventory-analytics-owner@korva.test',
        password: 'password123',
      })
      .expect(201);
    accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Inventory Analytics Org',
        type: 'ecommerce',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['crm', 'catalog', 'commerce', 'analytics'] })
      .expect(200);

    const contactRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ firstName: 'Client' })
      .expect(201);
    contactId = asSuccess<ContactPayload>(contactRes.body).id;

    async function createOffer(name: string): Promise<string> {
      const res = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name,
          pricing: { amount: 10, currency: 'EUR' },
          trackStock: true,
          stockOnHand: 0,
        })
        .expect(201);
      return asSuccess<OfferPayload>(res.body).id;
    }

    // soldOfferId: received 20 @ unitCost 5, then 8 sold via a real order.
    soldOfferId = await createOffer('Turnover Widget');
    await request(server)
      .post(`/api/v1/offers/${soldOfferId}/stock/movements`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ type: 'received', quantity: 20, unitCost: 5 })
      .expect(201);
    await request(server)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        contactId,
        items: [
          {
            offerId: soldOfferId,
            description: 'Turnover Widget',
            quantity: 8,
            unitPrice: 10,
          },
        ],
        currency: 'EUR',
      })
      .expect(201);

    // deadOfferId: received stock, costed, but never sold.
    deadOfferId = await createOffer('Dead Stock Widget');
    await request(server)
      .post(`/api/v1/offers/${deadOfferId}/stock/movements`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ type: 'received', quantity: 10, unitCost: 3 })
      .expect(201);

    // unvaluedOfferId: has stock (manual correction, no cost basis at all) — excluded from
    // valuation's entries/totalValue, counted in unvaluedOfferCount instead.
    unvaluedOfferId = await createOffer('Unvalued Widget');
    await request(server)
      .post(`/api/v1/offers/${unvaluedOfferId}/stock/adjust`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ stockOnHand: 4 })
      .expect(201);
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  it('turnover: reports units sold in the period and a stock-relative ratio, off the real order-driven sold movement', async () => {
    const res = await request(server)
      .get('/api/v1/analytics/inventory/turnover?days=30')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const entries = asSuccess<TurnoverEntry[]>(res.body);
    const soldEntry = entries.find((e) => e.offerId === soldOfferId);
    expect(soldEntry).toMatchObject({ currentStock: 12, unitsSoldInPeriod: 8 });
    expect(soldEntry!.turnoverRatio).toBeCloseTo(8 / 12);

    const deadEntry = entries.find((e) => e.offerId === deadOfferId);
    expect(deadEntry).toMatchObject({
      currentStock: 10,
      unitsSoldInPeriod: 0,
      turnoverRatio: 0,
    });
  });

  it('dead stock: flags the never-sold offer but not the recently-sold one', async () => {
    const res = await request(server)
      .get('/api/v1/analytics/inventory/dead-stock?days=90')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const entries = asSuccess<DeadStockEntry[]>(res.body);
    const offerIds = entries.map((e) => e.offerId);
    expect(offerIds).toContain(deadOfferId);
    expect(offerIds).not.toContain(soldOfferId);

    const deadEntry = entries.find((e) => e.offerId === deadOfferId)!;
    expect(deadEntry.currentStock).toBe(10);
    expect(deadEntry.lastSoldAt).toBeNull();
  });

  it('valuation: costed offers contribute currentStock*unitCost, uncosted offers are excluded and counted separately', async () => {
    const res = await request(server)
      .get('/api/v1/analytics/inventory/valuation')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const valuation = asSuccess<ValuationPayload>(res.body);

    const soldEntry = valuation.entries.find((e) => e.offerId === soldOfferId);
    expect(soldEntry).toMatchObject({
      currentStock: 12,
      unitCost: 5,
      totalValue: 60,
    });
    const deadEntry = valuation.entries.find((e) => e.offerId === deadOfferId);
    expect(deadEntry).toMatchObject({
      currentStock: 10,
      unitCost: 3,
      totalValue: 30,
    });

    expect(valuation.entries.some((e) => e.offerId === unvaluedOfferId)).toBe(
      false,
    );
    expect(valuation.unvaluedOfferCount).toBeGreaterThanOrEqual(1);
    expect(valuation.totalValue).toBe(90);
    expect(valuation.currency).toBe('EUR');
  });
});
