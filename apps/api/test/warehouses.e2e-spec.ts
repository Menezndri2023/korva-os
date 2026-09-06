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
interface ApiError {
  success: false;
  error: { code: string; message: string };
}

interface AuthPayload {
  accessToken: string;
}
interface OrganizationPayload {
  id: string;
}
interface OfferPayload {
  id: string;
  stockOnHand?: number;
}
interface WarehousePayload {
  id: string;
  name: string;
  isDefault: boolean;
}
interface StockLevelPayload {
  id: string;
  offerId: string;
  variantId?: string | null;
  warehouseId: string;
  quantity: number;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

/**
 * Split into its own spec file rather than appended to catalog.e2e-spec.ts: that file is already
 * close to its own AUTH_THROTTLE budget (30 registrations/60s per file — same reasoning
 * documented in subscription-product-overrides.e2e-spec.ts's own header comment), and adding
 * these tests directly to it pushed a later, unrelated test in that same file over budget
 * (confirmed by reproducing the 429 and moving these tests out). Each e2e spec file boots its
 * own NestApplication with its own in-memory ThrottlerStorage, so a separate file gets a fresh
 * budget.
 */
describe('Warehouses and per-location stock levels (Phase C2, e2e)', () => {
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

  async function registerOrgAndToken(email: string, orgName: string) {
    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    const accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: orgName,
        type: 'commerce',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    const organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['catalog'] })
      .expect(200);

    return { accessToken, organizationId };
  }

  describe('warehouses and per-location stock levels', () => {
    let accessToken: string;
    let organizationId: string;
    let offerId: string;
    let warehouseAId: string;
    let warehouseBId: string;

    beforeAll(async () => {
      ({ accessToken, organizationId } = await registerOrgAndToken(
        'warehouses-owner@korva.test',
        'Warehouses Org',
      ));

      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Tracked Widget',
          pricing: { amount: 10, currency: 'EUR' },
          trackStock: true,
          stockOnHand: 0,
        })
        .expect(201);
      offerId = asSuccess<OfferPayload>(offerRes.body).id;
    });

    it('the first warehouse created for an org is automatically its default', async () => {
      const res = await request(server)
        .post('/api/v1/warehouses')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ name: 'Entrepôt A' })
        .expect(201);
      const warehouseA = asSuccess<WarehousePayload>(res.body);
      warehouseAId = warehouseA.id;
      expect(warehouseA.isDefault).toBe(true);

      const secondRes = await request(server)
        .post('/api/v1/warehouses')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ name: 'Entrepôt B' })
        .expect(201);
      const warehouseB = asSuccess<WarehousePayload>(secondRes.body);
      warehouseBId = warehouseB.id;
      expect(warehouseB.isDefault).toBe(false);
    });

    it('receiving stock at a specific warehouse creates its StockLevel row and maintains the offer aggregate', async () => {
      await request(server)
        .post(`/api/v1/offers/${offerId}/stock/movements`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ type: 'received', quantity: 10, warehouseId: warehouseAId })
        .expect(201);

      const offerRes = await request(server)
        .get(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<OfferPayload>(offerRes.body).stockOnHand).toBe(10);

      const levelsRes = await request(server)
        .get(`/api/v1/offers/${offerId}/stock/levels`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const levels = asSuccess<StockLevelPayload[]>(levelsRes.body);
      expect(levels).toHaveLength(1);
      expect(levels[0]).toMatchObject({
        warehouseId: warehouseAId,
        quantity: 10,
      });

      // A second warehouse receiving stock adds to the SAME aggregate without touching
      // warehouse A's own row.
      await request(server)
        .post(`/api/v1/offers/${offerId}/stock/movements`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ type: 'received', quantity: 5, warehouseId: warehouseBId })
        .expect(201);

      const offerAfterRes = await request(server)
        .get(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<OfferPayload>(offerAfterRes.body).stockOnHand).toBe(15);

      const levelsAfterRes = await request(server)
        .get(`/api/v1/offers/${offerId}/stock/levels`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const levelsAfter = asSuccess<StockLevelPayload[]>(levelsAfterRes.body);
      expect(levelsAfter).toHaveLength(2);
      expect(
        levelsAfter.find((l) => l.warehouseId === warehouseAId)?.quantity,
      ).toBe(10);
      expect(
        levelsAfter.find((l) => l.warehouseId === warehouseBId)?.quantity,
      ).toBe(5);
    });

    it('rejects removing more stock from one warehouse than it holds even though the aggregate has enough, rolling back the aggregate (no drift)', async () => {
      // Aggregate is 15 (A=10, B=5) — 10 passes the aggregate-level guard but exceeds what B
      // alone holds, so this must fail at the warehouse-specific guard, not the aggregate one.
      const res = await request(server)
        .post(`/api/v1/offers/${offerId}/stock/movements`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ type: 'damaged', quantity: 10, warehouseId: warehouseBId })
        .expect(400);
      expect(asError(res.body).code).toBe('INSUFFICIENT_STOCK_AT_WAREHOUSE');

      // Aggregate must be exactly what it was before the rejected attempt (15) — not decremented
      // by the failed movement.
      const offerRes = await request(server)
        .get(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<OfferPayload>(offerRes.body).stockOnHand).toBe(15);
    });

    it('adjustStock scoped to one warehouse updates only that warehouse and preserves the other', async () => {
      await request(server)
        .post(`/api/v1/offers/${offerId}/stock/adjust`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ stockOnHand: 20, warehouseId: warehouseAId })
        .expect(201);

      const offerRes = await request(server)
        .get(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      // Warehouse A moved from 10 -> 20 (+10); warehouse B's 5 untouched; new aggregate = 25.
      expect(asSuccess<OfferPayload>(offerRes.body).stockOnHand).toBe(25);

      const levelsRes = await request(server)
        .get(`/api/v1/offers/${offerId}/stock/levels`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const levels = asSuccess<StockLevelPayload[]>(levelsRes.body);
      expect(levels.find((l) => l.warehouseId === warehouseAId)?.quantity).toBe(
        20,
      );
      expect(levels.find((l) => l.warehouseId === warehouseBId)?.quantity).toBe(
        5,
      );
    });

    it('cannot delete a warehouse that still holds stock, but can once cleared', async () => {
      const blockedRes = await request(server)
        .delete(`/api/v1/warehouses/${warehouseBId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(409);
      expect(asError(blockedRes.body).code).toBe('WAREHOUSE_IN_USE');

      await request(server)
        .post(`/api/v1/offers/${offerId}/stock/adjust`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ stockOnHand: 0, warehouseId: warehouseBId })
        .expect(201);

      await request(server)
        .delete(`/api/v1/warehouses/${warehouseBId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
    });

    it('denies a user from another organization reading warehouses via a foreign org id', async () => {
      const other = await registerOrgAndToken(
        'warehouses-other@korva.test',
        'Warehouses Other Org',
      );
      const res = await request(server)
        .get('/api/v1/warehouses')
        .set('Authorization', `Bearer ${other.accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(403);
      expect(asError(res.body).code).toBe('ORGANIZATION_ACCESS_DENIED');
    });
  });
});
