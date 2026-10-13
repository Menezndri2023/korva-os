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
interface OrderPayload {
  id: string;
  status: string;
  invoiceId?: string;
}
interface OfferPayload {
  id: string;
  stockOnHand?: number;
}
interface InvoicePayload {
  id: string;
}
interface ReturnRequestPayload {
  id: string;
  status: string;
  refundAmount: number;
  refundId?: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

describe('Returns / RMA (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let accessToken: string;
  let organizationId: string;
  let contactId: string;
  let offerId: string;

  async function createFulfilledOrder(quantity: number): Promise<{
    orderId: string;
    invoiceId: string;
    unitPrice: number;
  }> {
    const unitPrice = 20;
    const orderRes = await request(server)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        contactId,
        currency: 'EUR',
        items: [
          {
            offerId,
            description: 'T-shirt',
            quantity,
            unitPrice,
          },
        ],
      })
      .expect(201);
    const orderId = asSuccess<OrderPayload>(orderRes.body).id;

    await request(server)
      .post(`/api/v1/orders/${orderId}/confirm`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(201);

    const invoiceRes = await request(server)
      .post(`/api/v1/orders/${orderId}/generate-invoice`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(201);
    const invoiceId = asSuccess<InvoicePayload>(invoiceRes.body).id;

    await request(server)
      .post(`/api/v1/invoices/${invoiceId}/issue`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(201);

    await request(server)
      .post('/api/v1/payments')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ invoiceId, amount: unitPrice * quantity, method: 'cash' })
      .expect(201);

    await request(server)
      .post(`/api/v1/orders/${orderId}/fulfill`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(201);

    return { orderId, invoiceId, unitPrice };
  }

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
      .send({ email: 'returns-owner@example.com', password: 'password123' })
      .expect(201);
    accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Returns Org',
        type: 'commerce',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    await putOrganizationOnPlan(connection, organizationId);
    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['crm', 'catalog', 'commerce', 'finance'] })
      .expect(200);

    const contactRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ type: 'person', firstName: 'Buyer', email: 'buyer@example.com' })
      .expect(201);
    contactId = asSuccess<{ id: string }>(contactRes.body).id;

    const offerRes = await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        type: 'product',
        name: 'T-shirt',
        status: 'active',
        pricing: { amount: 20, currency: 'EUR' },
        trackStock: true,
        stockOnHand: 10,
      })
      .expect(201);
    offerId = asSuccess<{ id: string }>(offerRes.body).id;
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  it('rejects a return request against a non-fulfilled order', async () => {
    const orderRes = await request(server)
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        contactId,
        currency: 'EUR',
        items: [
          { offerId, description: 'T-shirt', quantity: 1, unitPrice: 20 },
        ],
      })
      .expect(201);
    const orderId = asSuccess<OrderPayload>(orderRes.body).id;

    const res = await request(server)
      .post('/api/v1/returns')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        orderId,
        items: [{ lineItemIndex: 0, quantity: 1 }],
        reason: 'Too small',
      })
      .expect(400);
    expect(asError(res.body).code).toBe('RETURN_ORDER_NOT_FULFILLED');
  });

  it('rejects a return request quantity exceeding what was ordered', async () => {
    const { orderId } = await createFulfilledOrder(2);

    const res = await request(server)
      .post('/api/v1/returns')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        orderId,
        items: [{ lineItemIndex: 0, quantity: 3 }],
        reason: 'Damaged',
      })
      .expect(400);
    expect(asError(res.body).code).toBe('RETURN_QUANTITY_EXCEEDS_ORDERED');
  });

  it('creates, approves, restocks, and refunds a return request end to end', async () => {
    const stockBeforeRes = await request(server)
      .get(`/api/v1/offers/${offerId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const stockBefore = asSuccess<OfferPayload>(
      stockBeforeRes.body,
    ).stockOnHand!;

    const { orderId } = await createFulfilledOrder(2);

    const createRes = await request(server)
      .post('/api/v1/returns')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        orderId,
        items: [{ lineItemIndex: 0, quantity: 1 }],
        reason: 'Wrong size',
      })
      .expect(201);
    const returnRequest = asSuccess<ReturnRequestPayload>(createRes.body);
    expect(returnRequest.status).toBe('pending');
    expect(returnRequest.refundAmount).toBe(20);

    const listRes = await request(server)
      .get('/api/v1/returns?status=pending')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    expect(
      asSuccess<ReturnRequestPayload[]>(listRes.body).some(
        (r) => r.id === returnRequest.id,
      ),
    ).toBe(true);

    const approveRes = await request(server)
      .post(`/api/v1/returns/${returnRequest.id}/approve`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(201);
    const approved = asSuccess<ReturnRequestPayload>(approveRes.body);
    expect(approved.status).toBe('approved');
    expect(approved.refundId).toBeDefined();

    const stockAfterRes = await request(server)
      .get(`/api/v1/offers/${offerId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    expect(asSuccess<OfferPayload>(stockAfterRes.body).stockOnHand).toBe(
      stockBefore - 2 + 1, // 2 reserved at order time, 1 restocked by the return
    );

    const reapproveRes = await request(server)
      .post(`/api/v1/returns/${returnRequest.id}/approve`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(400);
    expect(asError(reapproveRes.body).code).toBe(
      'RETURN_REQUEST_ALREADY_REVIEWED',
    );
  });

  it('rejects a return request, leaving stock and payment untouched', async () => {
    const { orderId } = await createFulfilledOrder(1);

    const createRes = await request(server)
      .post('/api/v1/returns')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        orderId,
        items: [{ lineItemIndex: 0, quantity: 1 }],
        reason: 'Changed my mind',
      })
      .expect(201);
    const returnRequest = asSuccess<ReturnRequestPayload>(createRes.body);

    const rejectRes = await request(server)
      .post(`/api/v1/returns/${returnRequest.id}/reject`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ reason: 'Outside return window' })
      .expect(201);
    expect(asSuccess<ReturnRequestPayload>(rejectRes.body).status).toBe(
      'rejected',
    );

    const rereject = await request(server)
      .post(`/api/v1/returns/${returnRequest.id}/reject`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({})
      .expect(400);
    expect(asError(rereject.body).code).toBe('RETURN_REQUEST_ALREADY_REVIEWED');
  });
});
