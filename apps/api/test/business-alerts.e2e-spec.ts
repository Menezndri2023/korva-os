import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { EMAIL_PROVIDER } from './../src/communication/providers/email-provider.interface';
import { putOrganizationOnPlan } from './support/plan-tier';

interface ApiSuccess<T> {
  success: true;
  data: T;
}
const asSuccess = <T>(body: unknown) => (body as ApiSuccess<T>).data;

/**
 * The business hears of what its site brings — an order, a request — by e-mail, in its own
 * language (2026-11-07: before, only an in-app notification, and only when the starter workflow
 * existed). Own file: it needs its own register/public throttle budget.
 */
describe('Business alerts (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  const emails: { to: string; subject: string; body: string }[] = [];
  let slug: string;
  let offerId: string;

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

    const token = asSuccess<{ accessToken: string }>(
      (
        await request(server)
          .post('/api/v1/auth/register')
          .send({ email: 'owner@konan.ci', password: 'password123' })
          .expect(201)
      ).body,
    ).accessToken;
    const org = asSuccess<{ id: string; slug: string }>(
      (
        await request(server)
          .post('/api/v1/organizations')
          .set('Authorization', `Bearer ${token}`)
          .send({
            name: 'Konan & Fils',
            type: 'commerce',
            country: 'CI',
            currency: 'XOF',
            timezone: 'Africa/Abidjan',
            language: 'fr',
          })
          .expect(201)
      ).body,
    );
    slug = org.slug;
    await putOrganizationOnPlan(connection, org.id, 'starter');
    const staff = (req: request.Test) =>
      req
        .set('Authorization', `Bearer ${token}`)
        .set('X-Organization-Id', org.id);
    await staff(request(server).patch('/api/v1/organizations/me'))
      .send({
        enabledModules: ['crm', 'catalog', 'commerce', 'finance', 'website'],
      })
      .expect(200);
    offerId = asSuccess<{ id: string }>(
      (
        await staff(request(server).post('/api/v1/offers'))
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

  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
  const toOwner = () => emails.filter((mail) => mail.to === 'owner@konan.ci');

  it('e-mails the owner a new order placed on the site', async () => {
    await request(server)
      .post(`/api/v1/public/${slug}/orders`)
      .send({
        items: [{ offerId, quantity: 2 }],
        currency: 'XOF',
        contact: { email: 'fatou@example.com', firstName: 'Fatou' },
      })
      .expect(201);
    await settle();
    const alert = toOwner().find((mail) =>
      mail.subject.startsWith('Nouvelle commande'),
    );
    expect(alert?.subject).toMatch(/30\s000/);
    expect(alert?.body).toContain('Fatou (fatou@example.com)');
  });

  it('e-mails the owner a request sent from the site, message included', async () => {
    await request(server)
      .post(`/api/v1/public/${slug}/leads`)
      .send({
        message: 'Bonjour, je voudrais un devis pour 40 pagnes <b>vite</b>.',
        source: 'website_quote',
        contact: { email: 'kofi@example.com' },
      })
      .expect(201);
    await settle();
    const alert = toOwner().find((mail) =>
      mail.subject.startsWith('Nouvelle demande'),
    );
    expect(alert?.body).toContain('40 pagnes &#60;b&#62;vite&#60;/b&#62;');
  });
});
