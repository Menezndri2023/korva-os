import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { io, Socket } from 'socket.io-client';
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
interface OrderPayload {
  id: string;
}
interface KitchenTicketPayload {
  ticket: { id: string; orderId: string; status: string };
  order: { id: string; items: { description: string }[] };
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

function waitForEvent(
  socket: Socket,
  event: string,
  timeoutMs = 5000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for "${event}"`)),
      timeoutMs,
    );
    socket.once(event, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Unlike every other e2e file in this suite, this one calls app.listen() to get a real TCP
 * port for socket.io-client to connect to — expect a benign "Jest did not exit one second
 * after the test run" warning after this file finishes. It's socket.io's own engine leaving a
 * handle open briefly, not a hang: results print in full and the process still exits (verified
 * by running this file standalone — a genuine hang, tried once via a `server.close()` call in
 * KitchenGateway's onModuleDestroy, looks completely different: zero output, zero CPU, for
 * many minutes, because that double-closes the same underlying HTTP server app.close() already
 * closes. Don't add that back without a much more careful test of the shutdown path.
 */
describe('Kitchen display (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let baseUrl: string;
  let accessToken: string;
  let organizationId: string;
  let contactId: string;
  let offerId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
    // Unlike every other e2e file in this suite, the WebSocket gateway genuinely needs a real
    // listening TCP port — supertest's request(app.getHttpServer()) never actually binds one,
    // but socket.io-client needs a real URL to connect to. Port 0 picks any free port.
    await app.listen(0);
    server = app.getHttpServer();
    const address = (server as unknown as import('net').Server).address();
    const port = typeof address === 'object' && address ? address.port : 0;
    baseUrl = `http://127.0.0.1:${port}`;

    connection = app.get(getConnectionToken());
    await connection.dropDatabase();
    await Promise.all(
      connection
        .modelNames()
        .map((name) => connection.model(name).syncIndexes()),
    );

    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'kitchen-owner@example.com', password: 'password123' })
      .expect(201);
    accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Kitchen Org',
        type: 'restaurant',
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
      .send({ enabledModules: ['crm', 'catalog', 'commerce'] })
      .expect(200);

    const contactRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ type: 'person', firstName: 'Table', lastName: '5' })
      .expect(201);
    contactId = asSuccess<{ id: string }>(contactRes.body).id;

    const offerRes = await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({
        type: 'product',
        name: 'Burger',
        status: 'active',
        pricing: { amount: 12, currency: 'EUR' },
      })
      .expect(201);
    offerId = asSuccess<{ id: string }>(offerRes.body).id;
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  async function openTab(): Promise<string> {
    const res = await request(server)
      .post('/api/v1/orders/open')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ contactId, currency: 'EUR' })
      .expect(201);
    return asSuccess<OrderPayload>(res.body).id;
  }

  it('creates a kitchen ticket automatically when a tab opens, status "new"', async () => {
    const orderId = await openTab();

    const listRes = await request(server)
      .get('/api/v1/kitchen-tickets')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const tickets = asSuccess<KitchenTicketPayload[]>(listRes.body);
    const mine = tickets.find((t) => t.ticket.orderId === orderId);
    expect(mine).toBeDefined();
    expect(mine!.ticket.status).toBe('new');
  });

  it('advances a ticket through new -> preparing -> ready -> served, then rejects further advance', async () => {
    const orderId = await openTab();
    const listRes = await request(server)
      .get('/api/v1/kitchen-tickets')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const ticketId = asSuccess<KitchenTicketPayload[]>(listRes.body).find(
      (t) => t.ticket.orderId === orderId,
    )!.ticket.id;

    for (const expected of ['preparing', 'ready', 'served']) {
      const res = await request(server)
        .post(`/api/v1/kitchen-tickets/${ticketId}/advance`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      expect(asSuccess<{ status: string }>(res.body).status).toBe(expected);
    }

    const rejectRes = await request(server)
      .post(`/api/v1/kitchen-tickets/${ticketId}/advance`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(400);
    expect(asError(rejectRes.body).code).toBe(
      'KITCHEN_TICKET_INVALID_TRANSITION',
    );
  });

  it('a "ready" ticket reverts to "new" when a new item lands on the tab', async () => {
    const orderId = await openTab();
    const listRes = await request(server)
      .get('/api/v1/kitchen-tickets')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const ticketId = asSuccess<KitchenTicketPayload[]>(listRes.body).find(
      (t) => t.ticket.orderId === orderId,
    )!.ticket.id;

    await request(server)
      .post(`/api/v1/kitchen-tickets/${ticketId}/advance`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(201);
    await request(server)
      .post(`/api/v1/kitchen-tickets/${ticketId}/advance`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(201); // now "ready"

    await request(server)
      .post(`/api/v1/orders/${orderId}/items`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ offerId, quantity: 1 })
      .expect(201);

    const afterRes = await request(server)
      .get('/api/v1/kitchen-tickets')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const after = asSuccess<KitchenTicketPayload[]>(afterRes.body).find(
      (t) => t.ticket.orderId === orderId,
    )!;
    expect(after.ticket.status).toBe('new');
    expect(after.order.items).toHaveLength(1);
  });

  it('list() excludes served tickets by default but includes them when asked explicitly', async () => {
    const defaultRes = await request(server)
      .get('/api/v1/kitchen-tickets')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const defaultList = asSuccess<KitchenTicketPayload[]>(defaultRes.body);
    expect(defaultList.some((t) => t.ticket.status === 'served')).toBe(false);

    const servedRes = await request(server)
      .get('/api/v1/kitchen-tickets?status=served')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    expect(
      asSuccess<KitchenTicketPayload[]>(servedRes.body).length,
    ).toBeGreaterThan(0);
  });

  describe('real-time updates over the /kitchen WebSocket namespace', () => {
    it('rejects a connection with no token', async () => {
      // The socket.io transport handshake itself completes (a real 'connect' event fires)
      // before handleConnection's async auth check runs and calls client.disconnect() — so the
      // observable behavior to assert is "connects, then is immediately disconnected by the
      // server", not "never connects at all".
      const socket = io(`${baseUrl}/kitchen`, {
        auth: {},
        reconnection: false,
        forceNew: true,
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('expected disconnect')),
          3000,
        );
        socket.on('disconnect', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      socket.close();
    });

    it('accepts a connection with a valid token + organizationId, and receives a broadcast on ticket advance', async () => {
      const socket = io(`${baseUrl}/kitchen`, {
        auth: { token: accessToken, organizationId },
        reconnection: false,
        forceNew: true,
      });
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error('expected connect')),
          5000,
        );
        socket.on('connect', () => {
          clearTimeout(timer);
          resolve();
        });
        socket.on('connect_error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

      const orderId = await openTab();
      const listRes = await request(server)
        .get('/api/v1/kitchen-tickets')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const ticketId = asSuccess<KitchenTicketPayload[]>(listRes.body).find(
        (t) => t.ticket.orderId === orderId,
      )!.ticket.id;

      const changePromise = waitForEvent(socket, 'kitchen.changed');
      await request(server)
        .post(`/api/v1/kitchen-tickets/${ticketId}/advance`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      await expect(changePromise).resolves.toBeUndefined();

      socket.close();
    });
  });
});
