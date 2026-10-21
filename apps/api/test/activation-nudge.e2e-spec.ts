import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { ActivationNudgeService } from './../src/activation/activation-nudge.service';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from './../src/communication/providers/email-provider.interface';

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

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ActivationNudgeService: one reminder, 2 to 7 days after signup, to an owner whose site still
 * has no offer online. Own file for the register-throttle budget.
 */
describe('Activation nudge (e2e)', () => {
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

  async function setupOrg(email: string, name: string, modules: string[]) {
    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    const accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name,
        type: 'services',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    const { id: organizationId, slug } = asSuccess<OrganizationPayload>(
      orgRes.body,
    );

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: modules })
      .expect(200);

    return { accessToken, organizationId, slug };
  }

  async function backdate(organizationId: string, days: number) {
    await connection
      .collection('organizations')
      .updateOne(
        { _id: new Types.ObjectId(organizationId) },
        { $set: { createdAt: new Date(Date.now() - days * DAY_MS) } },
      );
  }

  it('reminds an owner whose site is still empty, once, and only in the 2-7 day window', async () => {
    const nudges = app.get(ActivationNudgeService);

    const empty = await setupOrg('nudge-empty@korva.test', 'Empty Shop', [
      'website',
      'catalog',
    ]);
    await backdate(empty.organizationId, 3);

    const withOffer = await setupOrg('nudge-offer@korva.test', 'Busy Shop', [
      'website',
      'catalog',
    ]);
    await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${withOffer.accessToken}`)
      .set('X-Organization-Id', withOffer.organizationId)
      .send({
        type: 'product',
        name: 'Savon noir',
        pricing: { amount: 2500, currency: 'EUR' },
        status: 'active',
      })
      .expect(201);
    await backdate(withOffer.organizationId, 3);

    await setupOrg('nudge-young@korva.test', 'Young Shop', [
      'website',
      'catalog',
    ]);

    const old = await setupOrg('nudge-old@korva.test', 'Old Shop', [
      'website',
      'catalog',
    ]);
    await backdate(old.organizationId, 10);

    // Spied only now: registering the four owners above sent verification emails of its own.
    const send = jest.spyOn(app.get<EmailProvider>(EMAIL_PROVIDER), 'send');
    await nudges.sendDueNudges();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({
      to: 'nudge-empty@korva.test',
    });
    expect(send.mock.calls[0]![0].body).toContain('Empty Shop');
    expect(send.mock.calls[0]![0].body).toContain('/dashboard/catalog');

    // A second sweep never sends the same reminder twice.
    await nudges.sendDueNudges();
    expect(send).toHaveBeenCalledTimes(1);
    send.mockRestore();
  });
});
