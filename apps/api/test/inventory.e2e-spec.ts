import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
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
interface ContactPayload {
  id: string;
}
interface OfferPayload {
  id: string;
  stockOnHand?: number;
  trackStock: boolean;
  lowStockThreshold?: number;
  variants: { id: string; name: string; stockOnHand?: number }[];
}
interface StockMovementPayload {
  id: string;
  type: string;
  quantity: number;
  stockAfter: number;
  variantId?: string;
  reason?: string;
}
interface ApiPaginatedSuccess<T> {
  success: true;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
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
    // These scenarios create several automations in one organization, more than the free
    // plan's one (PLAN_LIMITS.workflows) — the tier is scaffolding here, not what is tested.
    await putOrganizationOnPlan(connection, organizationId, 'business');

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

  describe('offer.low_stock event (configurable reorder threshold)', () => {
    it('publishes offer.low_stock once stock drops to or below the configured threshold, verified by a Workflow firing', async () => {
      const ctx = await registerOrgContact(
        'inventory-lowstock-owner@korva.test',
        'Inventory Low Stock Org',
      );
      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({
          type: 'product',
          name: 'Threshold Widget',
          pricing: { amount: 10, currency: 'EUR' },
          trackStock: true,
          stockOnHand: 10,
          lowStockThreshold: 5,
        })
        .expect(201);
      const offer = asSuccess<OfferPayload>(offerRes.body);

      const workflowRes = await request(server)
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({
          name: 'On low stock',
          trigger: 'offer.low_stock',
          conditions: [],
          actions: [
            { type: 'create_task', config: { title: 'Restock {{offerId}}' } },
          ],
        })
        .expect(201);
      const workflowId = asSuccess<WorkflowPayload>(workflowRes.body).id;

      // Leaves 5 in stock — exactly at the threshold, must fire; not yet at 0, so
      // offer.stock_depleted must NOT also fire here.
      await request(server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({
          contactId: ctx.contactId,
          items: [
            {
              offerId: offer.id,
              description: 'Threshold Widget',
              quantity: 5,
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
      expect(executions[0]!.eventName).toBe('offer.low_stock');
      expect(executions[0]!.payload.offerId).toBe(offer.id);
      expect(executions[0]!.payload.stockOnHand).toBe(5);
      expect(executions[0]!.payload.lowStockThreshold).toBe(5);
    }, 20000);

    it('never fires for an offer with no lowStockThreshold configured, even at exactly 0 (stock_depleted alone covers that case)', async () => {
      const ctx = await registerOrgContact(
        'inventory-nolowstock-owner@korva.test',
        'Inventory No Low Stock Org',
      );
      const offer = await createTrackedOffer(
        ctx.accessToken,
        ctx.organizationId,
        3,
      );

      const workflowRes = await request(server)
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({
          name: 'On low stock (should never fire)',
          trigger: 'offer.low_stock',
          conditions: [],
          actions: [{ type: 'create_task', config: { title: 'Restock' } }],
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
              quantity: 3,
              unitPrice: 10,
            },
          ],
          currency: 'EUR',
        })
        .expect(201);

      // No polling wait-for-success here on purpose — there's nothing that will ever arrive.
      // A short, fixed pause is the only way to assert a negative against an async pipeline.
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const res = await request(server)
        .get(`/api/v1/workflows/${workflowId}/executions`)
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .expect(200);
      expect(asSuccess<WorkflowExecutionPayload[]>(res.body)).toHaveLength(0);
    });
  });

  describe('per-variant stock (independent of the offer and of sibling variants)', () => {
    it('reserves/restocks each variant independently, never touching the offer-level counter or the other variant', async () => {
      const ctx = await registerOrgContact(
        'inventory-variant-owner@korva.test',
        'Inventory Variant Org',
      );
      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({
          type: 'product',
          name: 'T-Shirt',
          pricing: { amount: 20, currency: 'EUR' },
          trackStock: true,
          variants: [
            { name: 'Small', stockOnHand: 3 },
            { name: 'Large', stockOnHand: 1 },
          ],
        })
        .expect(201);
      const offer = asSuccess<OfferPayload>(offerRes.body);
      const small = offer.variants.find((v) => v.name === 'Small')!;
      const large = offer.variants.find((v) => v.name === 'Large')!;

      // Buying the last "Large" must fail once its own stock hits 0, while "Small" is
      // untouched — proves the two variants really are independent counters.
      await request(server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({
          contactId: ctx.contactId,
          items: [
            {
              offerId: offer.id,
              variantId: large.id,
              description: 'T-Shirt (Large)',
              quantity: 1,
              unitPrice: 20,
            },
          ],
          currency: 'EUR',
        })
        .expect(201);

      const afterFirstOrder = asSuccess<OfferPayload>(
        (
          await request(server)
            .get(`/api/v1/offers/${offer.id}`)
            .set('Authorization', `Bearer ${ctx.accessToken}`)
            .set('X-Organization-Id', ctx.organizationId)
            .expect(200)
        ).body,
      );
      expect(
        afterFirstOrder.variants.find((v) => v.id === large.id)?.stockOnHand,
      ).toBe(0);
      expect(
        afterFirstOrder.variants.find((v) => v.id === small.id)?.stockOnHand,
      ).toBe(3);

      const rejectedRes = await request(server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({
          contactId: ctx.contactId,
          items: [
            {
              offerId: offer.id,
              variantId: large.id,
              description: 'T-Shirt (Large)',
              quantity: 1,
              unitPrice: 20,
            },
          ],
          currency: 'EUR',
        })
        .expect(400);
      expect(asError(rejectedRes.body).code).toBe('INSUFFICIENT_STOCK');

      // "Small" can still be bought — its own stock was never affected by Large's depletion.
      const secondOrderRes = await request(server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({
          contactId: ctx.contactId,
          items: [
            {
              offerId: offer.id,
              variantId: small.id,
              description: 'T-Shirt (Small)',
              quantity: 2,
              unitPrice: 20,
            },
          ],
          currency: 'EUR',
        })
        .expect(201);
      const secondOrderId = asSuccess<OrderPayload>(secondOrderRes.body).id;

      const afterSecondOrder = asSuccess<OfferPayload>(
        (
          await request(server)
            .get(`/api/v1/offers/${offer.id}`)
            .set('Authorization', `Bearer ${ctx.accessToken}`)
            .set('X-Organization-Id', ctx.organizationId)
            .expect(200)
        ).body,
      );
      expect(
        afterSecondOrder.variants.find((v) => v.id === small.id)?.stockOnHand,
      ).toBe(1);

      // Cancelling restores exactly the cancelled variant's stock.
      await request(server)
        .post(`/api/v1/orders/${secondOrderId}/cancel`)
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .expect(201);

      const afterCancel = asSuccess<OfferPayload>(
        (
          await request(server)
            .get(`/api/v1/offers/${offer.id}`)
            .set('Authorization', `Bearer ${ctx.accessToken}`)
            .set('X-Organization-Id', ctx.organizationId)
            .expect(200)
        ).body,
      );
      expect(
        afterCancel.variants.find((v) => v.id === small.id)?.stockOnHand,
      ).toBe(3);
      expect(
        afterCancel.variants.find((v) => v.id === large.id)?.stockOnHand,
      ).toBe(0);
    });

    it('adjustStock (absolute set) targets one variant via variantId, leaving the sibling untouched', async () => {
      const ctx = await registerOrgContact(
        'inventory-variant-adjust-owner@korva.test',
        'Inventory Variant Adjust Org',
      );
      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({
          type: 'product',
          name: 'Mug',
          pricing: { amount: 8, currency: 'EUR' },
          trackStock: true,
          variants: [
            { name: 'Blanc', stockOnHand: 10 },
            { name: 'Noir', stockOnHand: 10 },
          ],
        })
        .expect(201);
      const offer = asSuccess<OfferPayload>(offerRes.body);
      const white = offer.variants.find((v) => v.name === 'Blanc')!;
      const black = offer.variants.find((v) => v.name === 'Noir')!;

      await request(server)
        .post(`/api/v1/offers/${offer.id}/stock/adjust`)
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({ variantId: white.id, stockOnHand: 25 })
        .expect(201);

      const afterAdjust = asSuccess<OfferPayload>(
        (
          await request(server)
            .get(`/api/v1/offers/${offer.id}`)
            .set('Authorization', `Bearer ${ctx.accessToken}`)
            .set('X-Organization-Id', ctx.organizationId)
            .expect(200)
        ).body,
      );
      expect(
        afterAdjust.variants.find((v) => v.id === white.id)?.stockOnHand,
      ).toBe(25);
      expect(
        afterAdjust.variants.find((v) => v.id === black.id)?.stockOnHand,
      ).toBe(10);
    });
  });

  describe('stock movements ledger (POST/GET /offers/:id/stock/movements)', () => {
    it('records received/damaged/correction movements, each with the resulting stockAfter, and rejects a subtractive movement that would go below 0', async () => {
      const ctx = await registerOrgContact(
        'inventory-movements-owner@korva.test',
        'Inventory Movements Org',
      );
      const offer = await createTrackedOffer(
        ctx.accessToken,
        ctx.organizationId,
        10,
      );

      const receivedRes = await request(server)
        .post(`/api/v1/offers/${offer.id}/stock/movements`)
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({
          type: 'received',
          quantity: 5,
          reason: 'Livraison fournisseur',
        })
        .expect(201);
      const received = asSuccess<StockMovementPayload>(receivedRes.body);
      expect(received.type).toBe('received');
      expect(received.quantity).toBe(5);
      expect(received.stockAfter).toBe(15);
      expect(received.reason).toBe('Livraison fournisseur');

      const damagedRes = await request(server)
        .post(`/api/v1/offers/${offer.id}/stock/movements`)
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({ type: 'damaged', quantity: 3 })
        .expect(201);
      expect(asSuccess<StockMovementPayload>(damagedRes.body).stockAfter).toBe(
        12,
      );

      const correctionRes = await request(server)
        .post(`/api/v1/offers/${offer.id}/stock/movements`)
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({ type: 'correction', quantity: -2 })
        .expect(201);
      expect(
        asSuccess<StockMovementPayload>(correctionRes.body).stockAfter,
      ).toBe(10);

      const overdraftRes = await request(server)
        .post(`/api/v1/offers/${offer.id}/stock/movements`)
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({ type: 'damaged', quantity: 999 })
        .expect(400);
      expect(asError(overdraftRes.body).code).toBe('INSUFFICIENT_STOCK');

      const listRes = await request(server)
        .get(`/api/v1/offers/${offer.id}/stock/movements`)
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .expect(200);
      const page = listRes.body as ApiPaginatedSuccess<StockMovementPayload>;
      // Newest first: the rejected overdraft never wrote a row, so exactly 3 movements exist.
      expect(page.data).toHaveLength(3);
      expect(page.data[0]!.type).toBe('correction');
      expect(page.pagination.total).toBe(3);
    });

    it('rejects a manual movement on an offer without trackStock enabled', async () => {
      const ctx = await registerOrgContact(
        'inventory-movements-untracked-owner@korva.test',
        'Inventory Movements Untracked Org',
      );
      const untrackedRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({
          type: 'product',
          name: 'Untracked Item',
          pricing: { amount: 5, currency: 'EUR' },
        })
        .expect(201);
      const untracked = asSuccess<OfferPayload>(untrackedRes.body);

      const res = await request(server)
        .post(`/api/v1/offers/${untracked.id}/stock/movements`)
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({ type: 'received', quantity: 5 })
        .expect(400);
      expect(asError(res.body).code).toBe('STOCK_TRACKING_NOT_ENABLED');
    });

    it('rejects a movement naming a variant that does not exist on this offer', async () => {
      const ctx = await registerOrgContact(
        'inventory-movements-badvariant-owner@korva.test',
        'Inventory Movements Bad Variant Org',
      );
      const offer = await createTrackedOffer(
        ctx.accessToken,
        ctx.organizationId,
        10,
      );

      const res = await request(server)
        .post(`/api/v1/offers/${offer.id}/stock/movements`)
        .set('Authorization', `Bearer ${ctx.accessToken}`)
        .set('X-Organization-Id', ctx.organizationId)
        .send({
          type: 'received',
          quantity: 5,
          variantId: new Types.ObjectId().toString(),
        })
        .expect(404);
      expect(asError(res.body).code).toBe('OFFER_VARIANT_NOT_FOUND');
    });
  });
});
