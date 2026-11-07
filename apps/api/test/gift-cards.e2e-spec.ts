import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { EMAIL_PROVIDER } from './../src/communication/providers/email-provider.interface';
import { putOrganizationOnPlan } from './support/plan-tier';

const asSuccess = <T>(body: unknown) => (body as { data: T }).data;
const errorCode = (body: unknown) =>
  (body as { error: { code: string } }).error.code;

/**
 * Cartes cadeaux: issued in the dashboard and e-mailed, spent on the site's checkout and on an
 * invoice like money, never below zero, never twice the same balance; a disabled card refused.
 */
describe('Gift cards (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let token: string;
  let organizationId: string;
  let slug: string;
  let offerId: string;
  const emails: { to: string; subject: string; body: string }[] = [];
  const as = (req: request.Test) =>
    req
      .set('Authorization', `Bearer ${token}`)
      .set('X-Organization-Id', organizationId);

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue({
        send: (message: { to: string; subject: string; body: string }) => {
          emails.push(message);
          return Promise.resolve({ status: 'sent' });
        },
      })
      .compile();
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

    token = asSuccess<{ accessToken: string }>(
      (
        await request(server)
          .post('/api/v1/auth/register')
          .send({ email: 'owner@cadeaux.ci', password: 'password123' })
          .expect(201)
      ).body,
    ).accessToken;
    const org = asSuccess<{ id: string; slug: string }>(
      (
        await request(server)
          .post('/api/v1/organizations')
          .set('Authorization', `Bearer ${token}`)
          .send({
            name: 'Boutique Cadeaux',
            type: 'commerce',
            country: 'CI',
            currency: 'XOF',
            timezone: 'Africa/Abidjan',
            language: 'fr',
          })
          .expect(201)
      ).body,
    );
    organizationId = org.id;
    slug = org.slug;
    await putOrganizationOnPlan(connection, organizationId, 'starter');
    await as(request(server).patch('/api/v1/organizations/me'))
      .send({
        enabledModules: ['crm', 'catalog', 'commerce', 'finance', 'website'],
      })
      .expect(200);
    offerId = asSuccess<{ id: string }>(
      (
        await as(request(server).post('/api/v1/offers'))
          .send({
            type: 'product',
            name: 'Pagne wax',
            status: 'active',
            pricing: { amount: 15000, currency: 'XOF' },
          })
          .expect(201)
      ).body,
    ).id;
  }, 120_000);

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  let code: string;

  it('issues a card and e-mails its code to the recipient', async () => {
    const card = asSuccess<{ code: string; balance: number }>(
      (
        await as(request(server).post('/api/v1/gift-cards'))
          .send({
            amount: 10000,
            recipientName: 'Fatou',
            recipientEmail: 'fatou@example.com',
            message: 'Joyeux anniversaire',
            sendEmail: true,
          })
          .expect(201)
      ).body,
    );
    expect(card.code).toMatch(/^KDO-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(card.balance).toBe(10000);
    code = card.code;
    const mail = emails.find((sent) => sent.to === 'fatou@example.com');
    expect(mail?.body).toContain(card.code);
    expect(mail?.body).toContain('Joyeux anniversaire');
  });

  it('pays a site order with it, typed any way, and leaves the rest to pay', async () => {
    const typed = code.toLowerCase().replace(/-/g, ' ');
    const order = asSuccess<{
      id: string;
      total: number;
      giftCard: { amount: number; remaining: number };
    }>(
      (
        await request(server)
          .post(`/api/v1/public/${slug}/orders`)
          .send({
            items: [{ offerId, quantity: 1 }],
            currency: 'XOF',
            giftCardCode: typed,
            contact: { email: 'kofi@example.com' },
          })
          .expect(201)
      ).body,
    );
    expect(order.giftCard).toEqual({ amount: 10000, remaining: 5000 });
    const balance = asSuccess<{ balance: number; usable: boolean }>(
      (
        await request(server)
          .get(`/api/v1/public/${slug}/gift-cards/${code}`)
          .expect(200)
      ).body,
    );
    expect(balance).toMatchObject({ balance: 0, usable: false });

    // Spent: the next order with it is refused before anything is created.
    const refused = await request(server)
      .post(`/api/v1/public/${slug}/orders`)
      .send({
        items: [{ offerId, quantity: 1 }],
        currency: 'XOF',
        giftCardCode: code,
        contact: { email: 'ama@example.com' },
      })
      .expect(400);
    expect(errorCode(refused.body)).toBe('GIFT_CARD_EMPTY');
  });

  it('pays an invoice in the dashboard, and refuses a disabled card', async () => {
    const card = asSuccess<{ id: string; code: string }>(
      (
        await as(request(server).post('/api/v1/gift-cards'))
          .send({ amount: 3000 })
          .expect(201)
      ).body,
    );
    const contactId = asSuccess<{ id: string }>(
      (
        await as(request(server).post('/api/v1/contacts'))
          .send({ type: 'person', firstName: 'Awa' })
          .expect(201)
      ).body,
    ).id;
    const invoiceId = asSuccess<{ id: string }>(
      (
        await as(request(server).post('/api/v1/invoices'))
          .send({
            contactId,
            currency: 'XOF',
            items: [{ description: 'Retouche', quantity: 1, unitPrice: 2000 }],
          })
          .expect(201)
      ).body,
    ).id;
    await as(
      request(server).post(`/api/v1/invoices/${invoiceId}/issue`),
    ).expect(201);
    expect(
      asSuccess<{ amount: number; balance: number }>(
        (
          await as(request(server).post('/api/v1/gift-cards/pay'))
            .send({ code: card.code, invoiceId })
            .expect(200)
        ).body,
      ),
    ).toEqual({ amount: 2000, balance: 1000 });
    // The invoice is paid; nothing left to take from the card.
    await as(request(server).post('/api/v1/gift-cards/pay'))
      .send({ code: card.code, invoiceId })
      .expect(400);

    await as(
      request(server).post(`/api/v1/gift-cards/${card.id}/disable`),
    ).expect(200);
    const disabled = await request(server)
      .get(`/api/v1/public/${slug}/gift-cards/${card.code}`)
      .expect(200);
    expect(asSuccess<{ usable: boolean }>(disabled.body).usable).toBe(false);
  });
});
