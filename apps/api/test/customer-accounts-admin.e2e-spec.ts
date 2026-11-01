import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import type { CustomerAccountSummary } from '@korva/types';
import { AppModule } from './../src/app.module';
import { putOrganizationOnPlan } from './support/plan-tier';

/**
 * The business manages its customers' accounts (Clients › Espaces clients): lists them, sees
 * the last sign-in, suspends one (sign-in and refresh refused, sessions ended), restores it, and
 * sends a new-password link. And a site only offers "Se connecter" when an account can exist.
 */

interface ApiSuccess<T> {
  success: true;
  data: T;
}
function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function codeOf(body: unknown): string {
  return (body as { error: { code: string } }).error.code;
}

describe('Customer accounts, business side (e2e)', () => {
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
  }, 120_000);

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
  });

  it('lists, suspends, restores and resets a customer account; offers sign-in only where it can lead', async () => {
    const ownerToken = asSuccess<{ accessToken: string }>(
      (
        await request(server)
          .post('/api/v1/auth/register')
          .send({ email: 'owner@accounts.ci', password: 'password123' })
          .expect(201)
      ).body,
    ).accessToken;
    const organization = asSuccess<{ id: string; slug: string }>(
      (
        await request(server)
          .post('/api/v1/organizations')
          .set('Authorization', `Bearer ${ownerToken}`)
          .send({
            name: 'Boutique Comptes',
            type: 'commerce',
            country: 'CI',
            currency: 'XOF',
            timezone: 'Africa/Abidjan',
            language: 'fr',
          })
          .expect(201)
      ).body,
    );
    const asOwner = (req: request.Test) =>
      req
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Organization-Id', organization.id);
    const site = async () =>
      asSuccess<{
        customerAccountsEnabled: boolean;
        customerSignInAvailable: boolean;
      }>(
        (
          await request(server)
            .get(`/api/v1/public/${organization.slug}`)
            .expect(200)
        ).body,
      );

    // Free, no account yet: nothing to sign in to.
    expect(await site()).toMatchObject({
      customerAccountsEnabled: false,
      customerSignInAvailable: false,
    });

    await putOrganizationOnPlan(connection, organization.id, 'starter');
    expect((await site()).customerSignInAvailable).toBe(true);
    const account = `/api/v1/public/${organization.slug}/account`;
    const registered = asSuccess<{ refreshToken: string }>(
      (
        await request(server)
          .post(`${account}/register`)
          .send({
            email: 'awa@client.ci',
            password: 'password123',
            firstName: 'Awa',
          })
          .expect(201)
      ).body,
    );
    await request(server)
      .post(`${account}/login`)
      .send({ email: 'awa@client.ci', password: 'password123' })
      .expect(201);

    const list = asSuccess<CustomerAccountSummary[]>(
      (
        await asOwner(request(server).get('/api/v1/customer-accounts')).expect(
          200,
        )
      ).body,
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ email: 'awa@client.ci', name: 'Awa' });
    expect(list[0]!.lastLoginAt).toBeDefined();
    expect(list[0]!.disabledAt).toBeUndefined();
    const id = list[0]!.id;
    const byContact = asSuccess<CustomerAccountSummary>(
      (
        await asOwner(
          request(server).get(
            `/api/v1/customer-accounts/contact/${list[0]!.contactId}`,
          ),
        ).expect(200)
      ).body,
    );
    expect(byContact.id).toBe(id);

    // Suspended: sign-in refused (once the password is right), open sessions ended.
    await asOwner(
      request(server).post(`/api/v1/customer-accounts/${id}/disable`),
    ).expect(200);
    const refused = await request(server)
      .post(`${account}/login`)
      .send({ email: 'awa@client.ci', password: 'password123' })
      .expect(401);
    expect(codeOf(refused.body)).toBe('ACCOUNT_DISABLED');
    const wrongPassword = await request(server)
      .post(`${account}/login`)
      .send({ email: 'awa@client.ci', password: 'not-the-password' })
      .expect(401);
    expect(codeOf(wrongPassword.body)).toBe('INVALID_CREDENTIALS');
    await request(server)
      .post(`${account}/refresh`)
      .send({ refreshToken: registered.refreshToken })
      .expect(401);

    // Restored.
    await asOwner(
      request(server).post(`/api/v1/customer-accounts/${id}/enable`),
    ).expect(200);
    await request(server)
      .post(`${account}/login`)
      .send({ email: 'awa@client.ci', password: 'password123' })
      .expect(201);

    // A new-password link, as "Mot de passe oublié ?" would send.
    const before = await connection
      .collection('customer_password_reset_tokens')
      .countDocuments();
    await asOwner(
      request(server).post(`/api/v1/customer-accounts/${id}/password-reset`),
    ).expect(200);
    expect(
      await connection
        .collection('customer_password_reset_tokens')
        .countDocuments(),
    ).toBe(before + 1);

    // Back on Free: new accounts closed, but "Se connecter" stays for the existing one.
    await putOrganizationOnPlan(connection, organization.id, 'free');
    expect(await site()).toMatchObject({
      customerAccountsEnabled: false,
      customerSignInAvailable: true,
    });

    // Another business cannot see or touch it.
    const strangerToken = asSuccess<{ accessToken: string }>(
      (
        await request(server)
          .post('/api/v1/auth/register')
          .send({ email: 'stranger@accounts.ci', password: 'password123' })
          .expect(201)
      ).body,
    ).accessToken;
    const stranger = asSuccess<{ id: string }>(
      (
        await request(server)
          .post('/api/v1/organizations')
          .set('Authorization', `Bearer ${strangerToken}`)
          .send({
            name: 'Autre Boutique',
            type: 'commerce',
            country: 'CI',
            currency: 'XOF',
            timezone: 'Africa/Abidjan',
            language: 'fr',
          })
          .expect(201)
      ).body,
    );
    const asStranger = (req: request.Test) =>
      req
        .set('Authorization', `Bearer ${strangerToken}`)
        .set('X-Organization-Id', stranger.id);
    expect(
      asSuccess<CustomerAccountSummary[]>(
        (
          await asStranger(
            request(server).get('/api/v1/customer-accounts'),
          ).expect(200)
        ).body,
      ),
    ).toHaveLength(0);
    await asStranger(
      request(server).post(`/api/v1/customer-accounts/${id}/disable`),
    ).expect(404);
  });
});
