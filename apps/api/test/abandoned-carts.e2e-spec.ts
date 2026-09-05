import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AbandonedCartReminderSchedulerService } from '../src/commerce/carts/abandoned-cart-reminder-scheduler.service';

interface ApiSuccess<T> {
  success: true;
  data: T;
}
interface AuthPayload {
  accessToken: string;
}
interface OrganizationPayload {
  id: string;
  slug: string;
}
interface OfferPayload {
  id: string;
}
interface CartPayload {
  id: string;
  status: string;
  items: { offerId: string; quantity: number }[];
  notifiedAt?: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

const ONE_HOUR_MS = 60 * 60 * 1000;

describe('Abandoned-cart recovery (e2e)', () => {
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

  async function registerOrgWithOffer(email: string, orgName: string) {
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
    const organization = asSuccess<OrganizationPayload>(orgRes.body);

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ enabledModules: ['crm', 'catalog', 'commerce', 'communication'] })
      .expect(200);

    const offerRes = await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({
        type: 'product',
        name: 'Panier Widget',
        status: 'active',
        pricing: { amount: 20, currency: 'EUR' },
      })
      .expect(201);
    const offerId = asSuccess<OfferPayload>(offerRes.body).id;

    return { accessToken, organization, offerId };
  }

  async function backdateCartUpdatedAt(cartId: string, hoursAgo: number) {
    await connection
      .collection('carts')
      .updateOne(
        { _id: new Types.ObjectId(cartId) },
        { $set: { updatedAt: new Date(Date.now() - hoursAgo * ONE_HOUR_MS) } },
      );
  }

  // Direct DB lookup rather than the search API — avoids any assumption about how MongoDB's
  // $text index tokenizes an email address (hyphens/dots split unpredictably), which the
  // contacts search endpoint uses under the hood.
  async function findContactIdByEmail(
    organizationId: string,
    email: string,
  ): Promise<string> {
    const contact = await connection.collection('contacts').findOne({
      organizationId: new Types.ObjectId(organizationId),
      email,
    });
    return String(contact!._id);
  }

  it('creates a Cart for a newly-seen email and replaces its items on a later ping', async () => {
    const { accessToken, organization, offerId } = await registerOrgWithOffer(
      'abandoned-owner-1@korva.test',
      'Abandoned Cart Org 1',
    );

    await request(server)
      .post(`/api/v1/public/${organization.slug}/cart-checkout-started`)
      .send({
        contact: { email: 'shopper-1@korva.test', firstName: 'Ada' },
        items: [{ offerId, quantity: 2 }],
      })
      .expect(201);

    const contactId = await findContactIdByEmail(
      organization.id,
      'shopper-1@korva.test',
    );

    const firstCartRes = await request(server)
      .get(`/api/v1/carts?contactId=${contactId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    const firstCart = asSuccess<CartPayload>(firstCartRes.body);
    expect(firstCart.status).toBe('open');
    expect(firstCart.items).toHaveLength(1);
    expect(firstCart.items[0]?.quantity).toBe(2);

    // A later ping (customer changed quantity) replaces the whole snapshot rather than
    // incrementing — same cart id, new item list.
    await request(server)
      .post(`/api/v1/public/${organization.slug}/cart-checkout-started`)
      .send({
        contact: { email: 'shopper-1@korva.test' },
        items: [{ offerId, quantity: 5 }],
      })
      .expect(201);

    const secondCartRes = await request(server)
      .get(`/api/v1/carts?contactId=${contactId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    const secondCart = asSuccess<CartPayload>(secondCartRes.body);
    expect(secondCart.id).toBe(firstCart.id);
    expect(secondCart.items).toHaveLength(1);
    expect(secondCart.items[0]?.quantity).toBe(5);
  });

  it('marks the tracked cart converted once the customer completes a real order', async () => {
    const { accessToken, organization, offerId } = await registerOrgWithOffer(
      'abandoned-owner-2@korva.test',
      'Abandoned Cart Org 2',
    );

    await request(server)
      .post(`/api/v1/public/${organization.slug}/cart-checkout-started`)
      .send({
        contact: { email: 'shopper-2@korva.test' },
        items: [{ offerId, quantity: 1 }],
      })
      .expect(201);

    await request(server)
      .post(`/api/v1/public/${organization.slug}/orders`)
      .send({
        items: [{ offerId, quantity: 1 }],
        currency: 'EUR',
        contact: { email: 'shopper-2@korva.test' },
      })
      .expect(201);

    const contactId = await findContactIdByEmail(
      organization.id,
      'shopper-2@korva.test',
    );

    const cartRes = await request(server)
      .get(`/api/v1/carts?contactId=${contactId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    // getOrCreateForContact only ever finds an 'open' cart — since the tracked cart is now
    // 'converted', this call creates a brand new (empty, 'open') one, proving the original was
    // successfully closed out rather than left open for the scheduler to nag about.
    const freshCart = asSuccess<CartPayload>(cartRes.body);
    expect(freshCart.items).toHaveLength(0);
  });

  it('sends a recovery reminder for a cart left untouched past the threshold, then stops nagging', async () => {
    const { accessToken, organization, offerId } = await registerOrgWithOffer(
      'abandoned-owner-3@korva.test',
      'Abandoned Cart Org 3',
    );

    await request(server)
      .post(`/api/v1/public/${organization.slug}/cart-checkout-started`)
      .send({
        contact: { email: 'shopper-3@korva.test', firstName: 'Grace' },
        items: [{ offerId, quantity: 3 }],
      })
      .expect(201);

    const contactId = await findContactIdByEmail(
      organization.id,
      'shopper-3@korva.test',
    );

    const cartRes = await request(server)
      .get(`/api/v1/carts?contactId=${contactId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    const cartId = asSuccess<CartPayload>(cartRes.body).id;

    // Beyond the default 3h threshold.
    await backdateCartUpdatedAt(cartId, 4);

    const scheduler = app.get(AbandonedCartReminderSchedulerService);
    await scheduler.runSweep();

    const afterFirstSweep = await request(server)
      .get(`/api/v1/carts/${cartId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    const notified = asSuccess<CartPayload>(afterFirstSweep.body);
    expect(notified.status).toBe('abandoned');
    expect(notified.notifiedAt).toBeDefined();

    const conversationsRes = await request(server)
      .get('/api/v1/conversations')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    const conversations = asSuccess<{ channel: string; contactId: string }[]>(
      conversationsRes.body,
    );
    expect(
      conversations.some(
        (c) => c.channel === 'email' && c.contactId === contactId,
      ),
    ).toBe(true);

    // Backdate again — a second sweep must not re-notify a cart that's already 'abandoned', not
    // 'open' any more (the repository's own status:'open' filter excludes it).
    await backdateCartUpdatedAt(cartId, 4);
    await scheduler.runSweep();
    const afterSecondSweep = await request(server)
      .get(`/api/v1/carts/${cartId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    expect(asSuccess<CartPayload>(afterSecondSweep.body).notifiedAt).toBe(
      notified.notifiedAt,
    );

    const abandonedListRes = await request(server)
      .get('/api/v1/carts/abandoned')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    const abandonedList = asSuccess<CartPayload[]>(abandonedListRes.body);
    expect(abandonedList.some((c) => c.id === cartId)).toBe(true);
  });

  it('never touches a cart still within the threshold', async () => {
    const { accessToken, organization, offerId } = await registerOrgWithOffer(
      'abandoned-owner-4@korva.test',
      'Abandoned Cart Org 4',
    );

    await request(server)
      .post(`/api/v1/public/${organization.slug}/cart-checkout-started`)
      .send({
        contact: { email: 'shopper-4@korva.test' },
        items: [{ offerId, quantity: 1 }],
      })
      .expect(201);

    const scheduler = app.get(AbandonedCartReminderSchedulerService);
    await scheduler.runSweep();

    const contactId = await findContactIdByEmail(
      organization.id,
      'shopper-4@korva.test',
    );
    const cartRes = await request(server)
      .get(`/api/v1/carts?contactId=${contactId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .expect(200);
    expect(asSuccess<CartPayload>(cartRes.body).status).toBe('open');
  });
});
