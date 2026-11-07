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

/**
 * La carte de fidélité: three paid purchases earn the reward the business chose, the customer is
 * told by e-mail, the business marks it used once, and replaying a payment never stamps twice.
 */
describe('Loyalty card (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let token: string;
  let organizationId: string;
  let contactId: string;
  const emails: { to: string; subject: string }[] = [];
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
        send: (message: { to: string; subject: string }) => {
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
          .send({ email: 'owner@salon-fidele.ci', password: 'password123' })
          .expect(201)
      ).body,
    ).accessToken;
    organizationId = asSuccess<{ id: string }>(
      (
        await request(server)
          .post('/api/v1/organizations')
          .set('Authorization', `Bearer ${token}`)
          .send({
            name: 'Salon Fidèle',
            type: 'beauté',
            country: 'CI',
            currency: 'XOF',
            timezone: 'Africa/Abidjan',
            language: 'fr',
          })
          .expect(201)
      ).body,
    ).id;
    await putOrganizationOnPlan(connection, organizationId, 'starter');
    await as(request(server).patch('/api/v1/organizations/me'))
      .send({
        enabledModules: ['crm', 'finance'],
        loyalty: {
          enabled: true,
          stampsRequired: 3,
          reward: '1 coupe offerte',
        },
      })
      .expect(200);
    contactId = asSuccess<{ id: string }>(
      (
        await as(request(server).post('/api/v1/contacts'))
          .send({ type: 'person', firstName: 'Awa', email: 'awa@example.com' })
          .expect(201)
      ).body,
    ).id;
  }, 120_000);

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  async function paidInvoice(): Promise<string> {
    const invoiceId = asSuccess<{ id: string }>(
      (
        await as(request(server).post('/api/v1/invoices'))
          .send({
            contactId,
            currency: 'XOF',
            items: [{ description: 'Tresses', quantity: 1, unitPrice: 8000 }],
          })
          .expect(201)
      ).body,
    ).id;
    await as(
      request(server).post(`/api/v1/invoices/${invoiceId}/issue`),
    ).expect(201);
    await as(request(server).post('/api/v1/payments'))
      .send({ invoiceId, amount: 8000, method: 'cash' })
      .expect(201);
    return invoiceId;
  }
  const card = async () =>
    asSuccess<{
      stamps: number;
      rewardsAvailable: number;
      rewardsUsed: number;
      reward: string;
    }>(
      (
        await as(
          request(server).get(`/api/v1/contacts/${contactId}/loyalty`),
        ).expect(200)
      ).body,
    );

  it('stamps each paid purchase once, and tells the customer when the card is full', async () => {
    const first = await paidInvoice();
    expect(await card()).toMatchObject({
      stamps: 1,
      rewardsAvailable: 0,
      reward: '1 coupe offerte',
    });
    // The same invoice never stamps twice.
    await app
      .get(
        (await import('./../src/crm/loyalty/loyalty.service')).LoyaltyService,
      )
      .stampForInvoice(organizationId, first);
    expect((await card()).stamps).toBe(1);

    await paidInvoice();
    await paidInvoice();
    expect(await card()).toMatchObject({ stamps: 3, rewardsAvailable: 1 });
    expect(
      emails.some(
        (mail) =>
          mail.to === 'awa@example.com' &&
          mail.subject.includes('récompense fidélité'),
      ),
    ).toBe(true);
  });

  it('uses the reward once, and adds a stamp by hand', async () => {
    expect(
      asSuccess<{ stamps: number; rewardsUsed: number }>(
        (
          await as(
            request(server).post(
              `/api/v1/contacts/${contactId}/loyalty/redeem`,
            ),
          ).expect(200)
        ).body,
      ),
    ).toMatchObject({ stamps: 0, rewardsUsed: 1 });
    await as(
      request(server).post(`/api/v1/contacts/${contactId}/loyalty/redeem`),
    ).expect(400);
    expect(
      asSuccess<{ stamps: number }>(
        (
          await as(
            request(server).post(`/api/v1/contacts/${contactId}/loyalty/stamp`),
          ).expect(200)
        ).body,
      ).stamps,
    ).toBe(1);
  });
});
