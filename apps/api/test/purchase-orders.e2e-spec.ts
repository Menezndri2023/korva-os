import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { putOrganizationOnPlan } from './support/plan-tier';

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
  trackStock: boolean;
}
interface SupplierPayload {
  id: string;
  name: string;
  email?: string;
}
interface PurchaseOrderPayload {
  id: string;
  supplierId: string;
  status: string;
  currency: string;
  items: {
    offerId: string;
    name: string;
    quantity: number;
    unitCost: number;
  }[];
  receivedAt?: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

describe('Suppliers & purchase orders (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let accessToken: string;
  let organizationId: string;

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
      .send({ email: 'po-owner@korva.test', password: 'password123' })
      .expect(201);
    accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'PO Org',
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
      .send({ enabledModules: ['crm', 'catalog', 'commerce', 'workflow'] })
      .expect(200);
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  async function createOffer(
    trackStock: boolean,
    stockOnHand = 0,
  ): Promise<OfferPayload> {
    const res = await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        type: 'product',
        name: 'Restock Widget',
        pricing: { amount: 10, currency: 'EUR' },
        trackStock,
        stockOnHand,
      })
      .expect(201);
    return asSuccess<OfferPayload>(res.body);
  }

  async function createSupplier(
    name = 'Acme Supplies',
  ): Promise<SupplierPayload> {
    const res = await request(server)
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ name, email: 'contact@acme-supplies.test' })
      .expect(201);
    return asSuccess<SupplierPayload>(res.body);
  }

  describe('suppliers CRUD', () => {
    it('creates, lists (filtered by search), updates, and deletes a supplier', async () => {
      const supplier = await createSupplier('Filterable Supplier Co');
      expect(supplier.name).toBe('Filterable Supplier Co');

      const listRes = await request(server)
        .get('/api/v1/suppliers?search=Filterable')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(
        asSuccess<SupplierPayload[]>(listRes.body).some(
          (s) => s.id === supplier.id,
        ),
      ).toBe(true);

      const updateRes = await request(server)
        .patch(`/api/v1/suppliers/${supplier.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ phone: '0102030405' })
        .expect(200);
      expect(asSuccess<{ phone?: string }>(updateRes.body).phone).toBe(
        '0102030405',
      );

      await request(server)
        .delete(`/api/v1/suppliers/${supplier.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);

      await request(server)
        .get(`/api/v1/suppliers/${supplier.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(404);
    });

    it('refuses to delete a supplier with a non-cancelled purchase order', async () => {
      const supplier = await createSupplier('In-Use Supplier');
      const offer = await createOffer(true, 0);
      const poRes = await request(server)
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          supplierId: supplier.id,
          items: [{ offerId: offer.id, quantity: 5, unitCost: 4 }],
        })
        .expect(201);
      const po = asSuccess<PurchaseOrderPayload>(poRes.body);

      const deleteRes = await request(server)
        .delete(`/api/v1/suppliers/${supplier.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(409);
      expect(asError(deleteRes.body).code).toBe('SUPPLIER_IN_USE');

      // Cancelling the only PO clears the guard — a cancelled PO is inert history.
      await request(server)
        .post(`/api/v1/purchase-orders/${po.id}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      await request(server)
        .delete(`/api/v1/suppliers/${supplier.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
    });
  });

  describe('purchase order lifecycle', () => {
    it('creates a draft PO, snapshotting the offer name and currency', async () => {
      const supplier = await createSupplier();
      const offer = await createOffer(true, 0);

      const res = await request(server)
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          supplierId: supplier.id,
          items: [{ offerId: offer.id, quantity: 10, unitCost: 3.5 }],
          notes: 'Réappro trimestrielle',
        })
        .expect(201);
      const po = asSuccess<PurchaseOrderPayload>(res.body);
      expect(po.status).toBe('draft');
      expect(po.currency).toBe('EUR');
      expect(po.items[0]!.name).toBe('Restock Widget');
    });

    it('rejects a PO referencing a non-existent supplier', async () => {
      const offer = await createOffer(true, 0);
      const res = await request(server)
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          supplierId: '507f1f77bcf86cd799439011',
          items: [{ offerId: offer.id, quantity: 1, unitCost: 1 }],
        })
        .expect(404);
      expect(asError(res.body).code).toBe('SUPPLIER_NOT_FOUND');
    });

    it('rejects a PO referencing a non-existent offer', async () => {
      const supplier = await createSupplier();
      const res = await request(server)
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          supplierId: supplier.id,
          items: [
            { offerId: '507f1f77bcf86cd799439011', quantity: 1, unitCost: 1 },
          ],
        })
        .expect(404);
      expect(asError(res.body).code).toBe('OFFER_NOT_FOUND');
    });

    it('takes a draft through ordered -> received, incrementing stock and logging a movement', async () => {
      const supplier = await createSupplier();
      const offer = await createOffer(true, 2);

      const createRes = await request(server)
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          supplierId: supplier.id,
          items: [{ offerId: offer.id, quantity: 8, unitCost: 2 }],
        })
        .expect(201);
      const po = asSuccess<PurchaseOrderPayload>(createRes.body);

      const orderedRes = await request(server)
        .post(`/api/v1/purchase-orders/${po.id}/mark-ordered`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      expect(asSuccess<PurchaseOrderPayload>(orderedRes.body).status).toBe(
        'ordered',
      );

      const receiveRes = await request(server)
        .post(`/api/v1/purchase-orders/${po.id}/receive`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      const received = asSuccess<PurchaseOrderPayload>(receiveRes.body);
      expect(received.status).toBe('received');
      expect(received.receivedAt).toBeDefined();

      const offerRes = await request(server)
        .get(`/api/v1/offers/${offer.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<OfferPayload>(offerRes.body).stockOnHand).toBe(10);

      const movementsRes = await request(server)
        .get(`/api/v1/offers/${offer.id}/stock/movements`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const movements = asSuccess<
        { type: string; quantity: number; reason?: string }[]
      >(movementsRes.body);
      expect(
        movements.some(
          (m) =>
            m.type === 'received' &&
            m.quantity === 8 &&
            m.reason?.includes(po.id),
        ),
      ).toBe(true);
    });

    it('receives a PO across two partial deliveries, staying "ordered" until the second one completes it', async () => {
      const supplier = await createSupplier();
      const offer = await createOffer(true, 0);

      const createRes = await request(server)
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          supplierId: supplier.id,
          items: [{ offerId: offer.id, quantity: 10, unitCost: 2 }],
        })
        .expect(201);
      const po = asSuccess<PurchaseOrderPayload>(createRes.body);
      await request(server)
        .post(`/api/v1/purchase-orders/${po.id}/mark-ordered`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const firstReceiveRes = await request(server)
        .post(`/api/v1/purchase-orders/${po.id}/receive`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ items: [{ offerId: offer.id, quantity: 4 }] })
        .expect(201);
      const afterFirst = asSuccess<PurchaseOrderPayload>(firstReceiveRes.body);
      expect(afterFirst.status).toBe('ordered');
      expect(afterFirst.receivedAt).toBeUndefined();

      const offerAfterFirstRes = await request(server)
        .get(`/api/v1/offers/${offer.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<OfferPayload>(offerAfterFirstRes.body).stockOnHand).toBe(
        4,
      );

      const secondReceiveRes = await request(server)
        .post(`/api/v1/purchase-orders/${po.id}/receive`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ items: [{ offerId: offer.id, quantity: 6 }] })
        .expect(201);
      const afterSecond = asSuccess<PurchaseOrderPayload>(
        secondReceiveRes.body,
      );
      expect(afterSecond.status).toBe('received');
      expect(afterSecond.receivedAt).toBeDefined();

      const offerAfterSecondRes = await request(server)
        .get(`/api/v1/offers/${offer.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(
        asSuccess<OfferPayload>(offerAfterSecondRes.body).stockOnHand,
      ).toBe(10);
    });

    it('rejects receiving more than the remaining quantity on a line', async () => {
      const supplier = await createSupplier();
      const offer = await createOffer(true, 0);
      const createRes = await request(server)
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          supplierId: supplier.id,
          items: [{ offerId: offer.id, quantity: 5, unitCost: 2 }],
        })
        .expect(201);
      const po = asSuccess<PurchaseOrderPayload>(createRes.body);
      await request(server)
        .post(`/api/v1/purchase-orders/${po.id}/mark-ordered`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const res = await request(server)
        .post(`/api/v1/purchase-orders/${po.id}/receive`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ items: [{ offerId: offer.id, quantity: 6 }] })
        .expect(400);
      expect(asError(res.body).code).toBe('PURCHASE_ORDER_OVERRECEIVE');
    });

    it('rejects a second receive call once every line is already fully received', async () => {
      const supplier = await createSupplier();
      const offer = await createOffer(true, 0);
      const createRes = await request(server)
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          supplierId: supplier.id,
          items: [{ offerId: offer.id, quantity: 3, unitCost: 2 }],
        })
        .expect(201);
      const po = asSuccess<PurchaseOrderPayload>(createRes.body);
      await request(server)
        .post(`/api/v1/purchase-orders/${po.id}/mark-ordered`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      await request(server)
        .post(`/api/v1/purchase-orders/${po.id}/receive`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const res = await request(server)
        .post(`/api/v1/purchase-orders/${po.id}/receive`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(res.body).code).toBe('PURCHASE_ORDER_NOT_ORDERED');
    });

    it('rejects receiving a line item that is not on the purchase order', async () => {
      const supplier = await createSupplier();
      const offer = await createOffer(true, 0);
      const otherOffer = await createOffer(true, 0);
      const createRes = await request(server)
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          supplierId: supplier.id,
          items: [{ offerId: offer.id, quantity: 3, unitCost: 2 }],
        })
        .expect(201);
      const po = asSuccess<PurchaseOrderPayload>(createRes.body);
      await request(server)
        .post(`/api/v1/purchase-orders/${po.id}/mark-ordered`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const res = await request(server)
        .post(`/api/v1/purchase-orders/${po.id}/receive`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ items: [{ offerId: otherOffer.id, quantity: 1 }] })
        .expect(404);
      expect(asError(res.body).code).toBe('PURCHASE_ORDER_LINE_NOT_FOUND');
    });

    it('rejects receiving a PO that is still a draft', async () => {
      const supplier = await createSupplier();
      const offer = await createOffer(true, 0);
      const createRes = await request(server)
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          supplierId: supplier.id,
          items: [{ offerId: offer.id, quantity: 1, unitCost: 1 }],
        })
        .expect(201);
      const po = asSuccess<PurchaseOrderPayload>(createRes.body);

      const res = await request(server)
        .post(`/api/v1/purchase-orders/${po.id}/receive`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(res.body).code).toBe('PURCHASE_ORDER_NOT_ORDERED');
    });

    it('rejects receiving a PO whose offer no longer tracks stock', async () => {
      const supplier = await createSupplier();
      const offer = await createOffer(true, 0);
      const createRes = await request(server)
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          supplierId: supplier.id,
          items: [{ offerId: offer.id, quantity: 1, unitCost: 1 }],
        })
        .expect(201);
      const po = asSuccess<PurchaseOrderPayload>(createRes.body);
      await request(server)
        .post(`/api/v1/purchase-orders/${po.id}/mark-ordered`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      await request(server)
        .patch(`/api/v1/offers/${offer.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ trackStock: false })
        .expect(200);

      const res = await request(server)
        .post(`/api/v1/purchase-orders/${po.id}/receive`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(res.body).code).toBe('STOCK_TRACKING_NOT_ENABLED');
    });

    it('cancels a draft PO directly, and an ordered PO too, but not a received one', async () => {
      const supplier = await createSupplier();
      const offer = await createOffer(true, 0);

      const draftRes = await request(server)
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          supplierId: supplier.id,
          items: [{ offerId: offer.id, quantity: 1, unitCost: 1 }],
        })
        .expect(201);
      const draftPo = asSuccess<PurchaseOrderPayload>(draftRes.body);
      const cancelledRes = await request(server)
        .post(`/api/v1/purchase-orders/${draftPo.id}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      expect(asSuccess<PurchaseOrderPayload>(cancelledRes.body).status).toBe(
        'cancelled',
      );

      const secondRes = await request(server)
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          supplierId: supplier.id,
          items: [{ offerId: offer.id, quantity: 1, unitCost: 1 }],
        })
        .expect(201);
      const secondPo = asSuccess<PurchaseOrderPayload>(secondRes.body);
      await request(server)
        .post(`/api/v1/purchase-orders/${secondPo.id}/mark-ordered`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      await request(server)
        .post(`/api/v1/purchase-orders/${secondPo.id}/receive`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const notCancellableRes = await request(server)
        .post(`/api/v1/purchase-orders/${secondPo.id}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(notCancellableRes.body).code).toBe(
        'PURCHASE_ORDER_NOT_CANCELLABLE',
      );
    });
  });

  describe('RBAC', () => {
    it('a STAFF member can read but not create purchase orders', async () => {
      const memberAuthRes = await request(server)
        .post('/api/v1/auth/register')
        .send({ email: 'po-staff@korva.test', password: 'password123' })
        .expect(201);
      const memberAccessToken = asSuccess<AuthPayload>(
        memberAuthRes.body,
      ).accessToken;

      // A paid tier first: this organization is about to take on a second member, and the free
      // plan is one seat — the owner's. Seat enforcement is covered by subscriptions.e2e-spec.ts.
      await putOrganizationOnPlan(connection, organizationId);

      const rolesRes = await request(server)
        .get('/api/v1/roles')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const staffRole = asSuccess<{ id: string; systemKey?: string }[]>(
        rolesRes.body,
      ).find((r) => r.systemKey === 'STAFF')!;

      await request(server)
        .post('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ email: 'po-staff@korva.test', roleId: staffRole.id })
        .expect(201);

      await request(server)
        .get('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${memberAccessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);

      const supplier = await createSupplier();
      const offer = await createOffer(true, 0);
      const forbiddenRes = await request(server)
        .post('/api/v1/purchase-orders')
        .set('Authorization', `Bearer ${memberAccessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          supplierId: supplier.id,
          items: [{ offerId: offer.id, quantity: 1, unitCost: 1 }],
        })
        .expect(403);
      expect(asError(forbiddenRes.body).code).toBe('PERMISSION_DENIED');
    });
  });
});
