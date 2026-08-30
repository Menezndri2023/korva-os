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
interface ContactPayload {
  id: string;
}
interface OfferPayload {
  id: string;
  stockOnHand?: number;
  trackStock: boolean;
}
interface OrderPayload {
  id: string;
  status: string;
}
interface WorkflowPayload {
  id: string;
}
interface WorkflowExecutionPayload {
  status: string;
  eventName: string;
  payload: Record<string, unknown>;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

async function waitFor<T>(
  check: () => Promise<T | undefined>,
  timeoutMs = 15000,
  intervalMs = 300,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() > deadline) {
      throw new Error('waitFor: timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe('Inventory / stock ledger (e2e)', () => {
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

  async function registerOrgContact(email: string, orgName: string) {
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
        type: 'ecommerce',
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
      .send({ enabledModules: ['crm', 'catalog', 'commerce', 'workflow'] })
      .expect(200);

    const contactRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ firstName: 'Buyer' })
      .expect(201);
    const contactId = asSuccess<ContactPayload>(contactRes.body).id;

    return { accessToken, organizationId, contactId };
  }

  async function createTrackedOffer(
    accessToken: string,
    organizationId: string,
    stockOnHand: number,
  ): Promise<OfferPayload> {
    const res = await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        type: 'product',
        name: 'Tracked Widget',
        pricing: { amount: 10, currency: 'EUR' },
        trackStock: true,
        stockOnHand,
      })
      .expect(201);
    return asSuccess<OfferPayload>(res.body);
  }

  describe('order creation reserves stock, cancellation restocks', () => {
    let accessToken: string;
    let organizationId: string;
    let contactId: string;
    let offer: OfferPayload;

    beforeAll(async () => {
      const ctx = await registerOrgContact(
        'inventory-owner@korva.test',
        'Inventory Org',
      );
      accessToken = ctx.accessToken;
      organizationId = ctx.organizationId;
      contactId = ctx.contactId;
      offer = await createTrackedOffer(accessToken, organizationId, 5);
    });

    it('decrements stock on order creation', async () => {
      const res = await request(server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          items: [
            {
              offerId: offer.id,
              description: 'Tracked Widget',
              quantity: 3,
              unitPrice: 10,
            },
          ],
          currency: 'EUR',
        })
        .expect(201);
      expect(asSuccess<OrderPayload>(res.body).status).toBe('pending');

      const offerRes = await request(server)
        .get(`/api/v1/offers/${offer.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<OfferPayload>(offerRes.body).stockOnHand).toBe(2);
    });

    it('rejects an order that exceeds remaining stock with INSUFFICIENT_STOCK, leaving stock unchanged', async () => {
      const res = await request(server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          items: [
            {
              offerId: offer.id,
              description: 'Tracked Widget',
              quantity: 3,
              unitPrice: 10,
            },
          ],
          currency: 'EUR',
        })
        .expect(400);
      expect(asError(res.body).code).toBe('INSUFFICIENT_STOCK');

      const offerRes = await request(server)
        .get(`/api/v1/offers/${offer.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<OfferPayload>(offerRes.body).stockOnHand).toBe(2);
    });

    it('restocks on order cancellation', async () => {
      const orderRes = await request(server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          items: [
            {
              offerId: offer.id,
              description: 'Tracked Widget',
              quantity: 2,
              unitPrice: 10,
            },
          ],
          currency: 'EUR',
        })
        .expect(201);
      const orderId = asSuccess<OrderPayload>(orderRes.body).id;

      const offerAfterCreate = await request(server)
        .get(`/api/v1/offers/${offer.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<OfferPayload>(offerAfterCreate.body).stockOnHand).toBe(
        0,
      );

      await request(server)
        .post(`/api/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const offerAfterCancel = await request(server)
        .get(`/api/v1/offers/${offer.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<OfferPayload>(offerAfterCancel.body).stockOnHand).toBe(
        2,
      );
    });
  });

  describe('open tab (addItem/removeItem) reserves and restocks incrementally', () => {
    let accessToken: string;
    let organizationId: string;
    let contactId: string;
    let offer: OfferPayload;
    let orderId: string;

    beforeAll(async () => {
      const ctx = await registerOrgContact(
        'inventory-tab-owner@korva.test',
        'Inventory Tab Org',
      );
      accessToken = ctx.accessToken;
      organizationId = ctx.organizationId;
      contactId = ctx.contactId;
      offer = await createTrackedOffer(accessToken, organizationId, 4);

      const openRes = await request(server)
        .post('/api/v1/orders/open')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ contactId, currency: 'EUR' })
        .expect(201);
      orderId = asSuccess<OrderPayload>(openRes.body).id;
    });

    it('addItem decrements stock by the added quantity', async () => {
      await request(server)
        .post(`/api/v1/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ offerId: offer.id, quantity: 3 })
        .expect(201);

      const offerRes = await request(server)
        .get(`/api/v1/offers/${offer.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<OfferPayload>(offerRes.body).stockOnHand).toBe(1);
    });

    it('a second addItem beyond remaining stock is rejected with INSUFFICIENT_STOCK', async () => {
      const res = await request(server)
        .post(`/api/v1/orders/${orderId}/items`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ offerId: offer.id, quantity: 2 })
        .expect(400);
      expect(asError(res.body).code).toBe('INSUFFICIENT_STOCK');
    });

    it('removeItem restocks the removed quantity', async () => {
      await request(server)
        .delete(`/api/v1/orders/${orderId}/items/0`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);

      const offerRes = await request(server)
        .get(`/api/v1/offers/${offer.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<OfferPayload>(offerRes.body).stockOnHand).toBe(4);
    });
  });

  describe('manual stock adjustment', () => {
    it('lets staff set stockOnHand to an absolute value via /stock/adjust, but only when tracking is enabled', async () => {
      const ctx = await registerOrgContact(
        'inventory-adjust-owner@korva.test',
        'Inventory Adjust Org',
      );
      const tracked = await createTrackedOffer(
        ctx.accessToken,
        ctx.organizationId,
        10,
      );

      const adjustRes = await request(server)
        .post(`/api/v1/offers/${tracked.id}/stock/adjust`)
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({ stockOnHand: 50 })
        .expect(201);
      expect(asSuccess<OfferPayload>(adjustRes.body).stockOnHand).toBe(50);

      const untrackedRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({
          type: 'product',
          name: 'Untracked Widget',
          pricing: { amount: 5, currency: 'EUR' },
        })
        .expect(201);
      const untracked = asSuccess<OfferPayload>(untrackedRes.body);

      const rejectedRes = await request(server)
        .post(`/api/v1/offers/${untracked.id}/stock/adjust`)
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({ stockOnHand: 5 })
        .expect(400);
      expect(asError(rejectedRes.body).code).toBe('STOCK_TRACKING_NOT_ENABLED');
    });
  });

  describe('offer.stock_depleted event', () => {
    it('publishes offer.stock_depleted when a decrement brings stock to exactly 0, verified by a Workflow firing', async () => {
      const ctx = await registerOrgContact(
        'inventory-depleted-owner@korva.test',
        'Inventory Depleted Org',
      );
      const offer = await createTrackedOffer(
        ctx.accessToken,
        ctx.organizationId,
        2,
      );

      const workflowRes = await request(server)
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({
          name: 'On stock depleted',
          trigger: 'offer.stock_depleted',
          conditions: [],
          actions: [
            {
              type: 'create_task',
              config: { title: 'Restock {{offerId}}' },
            },
          ],
        })
        .expect(201);
      const workflowId = asSuccess<WorkflowPayload>(workflowRes.body).id;

      await request(server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({
          contactId: ctx.contactId,
          items: [
            {
              offerId: offer.id,
              description: 'Tracked Widget',
              quantity: 2,
              unitPrice: 10,
            },
          ],
          currency: 'EUR',
        })
        .expect(201);

      const executions = await waitFor(async () => {
        const res = await request(server)
          .get(`/api/v1/workflows/${workflowId}/executions`)
          .set('Authorization', `Bearer ${ctx.accessToken}`)
          .set('X-Organization-Id', ctx.organizationId)
          .expect(200);
        const data = asSuccess<WorkflowExecutionPayload[]>(res.body);
        return data.length > 0 ? data : undefined;
      });

      expect(executions).toHaveLength(1);
      expect(executions[0]!.status).toBe('success');
      expect(executions[0]!.eventName).toBe('offer.stock_depleted');
      expect(executions[0]!.payload.offerId).toBe(offer.id);
    }, 20000);
  });
});
