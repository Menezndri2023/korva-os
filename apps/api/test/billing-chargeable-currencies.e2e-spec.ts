import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import {
  putOrganizationOnPlan,
  payPendingPlanChange,
} from './support/plan-tier';

interface ApiSuccess<T> {
  success: true;
  data: T;
}
interface ApiError {
  success: false;
  error: { code: string; message: string; details?: unknown };
}
interface AuthPayload {
  accessToken: string;
}
interface OrganizationPayload {
  id: string;
}
interface SubscriptionSummaryPayload {
  plan: { key: string };
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

/**
 * BILLING_CHARGEABLE_CURRENCIES — the currencies the configured Flow A payment provider can
 * actually collect, which is narrower than what the catalog is priced in.
 *
 * Flow A resolves ONE market-independent provider for every tenant, so a currency it cannot
 * charge is a priced plan nobody can pay for. Without the guard this covers, an owner in France
 * would switch plan, have an invoice issued in their name, reach a hosted checkout and only
 * there be rejected by the provider with an opaque error.
 *
 * Its own spec file because the variable is read through ConfigService at boot: setting it in a
 * suite that boots one app for many tests would silently change every other test in that file.
 */
describe('Billing — chargeable currencies (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let previous: string | undefined;

  beforeAll(async () => {
    previous = process.env.BILLING_CHARGEABLE_CURRENCIES;
    // Set BEFORE the module compiles: ConfigModule snapshots the environment at boot.
    process.env.BILLING_CHARGEABLE_CURRENCIES = 'XOF';

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
    if (previous === undefined) {
      delete process.env.BILLING_CHARGEABLE_CURRENCIES;
    } else {
      process.env.BILLING_CHARGEABLE_CURRENCIES = previous;
    }
  });

  /** An organization in the given country/currency, with its owner's token. */
  async function setupOrg(email: string, country: string, currency: string) {
    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    const accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: `Org ${currency}`,
        type: 'services',
        country,
        currency,
        timezone: 'Africa/Abidjan',
        language: 'fr',
      })
      .expect(201);

    return {
      accessToken,
      organizationId: asSuccess<OrganizationPayload>(orgRes.body).id,
    };
  }

  function changePlan(
    accessToken: string,
    organizationId: string,
    planKey: string,
  ) {
    return request(server)
      .post('/api/v1/subscriptions/change-plan')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ planKey });
  }

  it('refuses a paid plan in a currency the provider cannot collect, before issuing anything', async () => {
    const { accessToken, organizationId } = await setupOrg(
      'chargeable-eur@korva.test',
      'FR',
      'EUR',
    );

    const res = await changePlan(accessToken, organizationId, 'starter').expect(
      422,
    );
    expect(asError(res.body).code).toBe('CURRENCY_NOT_CHARGEABLE');
    // The message has to be actionable by a human, not just a code: it names the currency that
    // failed and the ones that work.
    expect(asError(res.body).message).toContain('EUR');
    expect(asError(res.body).message).toContain('XOF');

    // Refused means refused: still on free, and no invoice was issued in their name.
    const summary = await request(server)
      .get('/api/v1/subscriptions/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    expect(asSuccess<SubscriptionSummaryPayload>(summary.body).plan.key).toBe(
      'free',
    );
    const invoices = await connection
      .collection('subscriptioninvoices')
      .countDocuments({});
    expect(invoices).toBe(0);
  });

  it('allows the same paid plan in a currency the provider can collect', async () => {
    const { accessToken, organizationId } = await setupOrg(
      'chargeable-xof@korva.test',
      'CI',
      'XOF',
    );

    await changePlan(accessToken, organizationId, 'starter').expect(201);
    await payPendingPlanChange(app, organizationId);

    const summary = await request(server)
      .get('/api/v1/subscriptions/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    expect(asSuccess<SubscriptionSummaryPayload>(summary.body).plan.key).toBe(
      'starter',
    );
  });

  it('never blocks the free plan, so the product stays usable where KORVA cannot yet bill', async () => {
    // The whole shape of this limitation: restrict taking money, not using the product. An
    // organization in France gets the entire free tier.
    const { accessToken, organizationId } = await setupOrg(
      'chargeable-eur-free@korva.test',
      'FR',
      'EUR',
    );

    const summary = await request(server)
      .get('/api/v1/subscriptions/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    expect(asSuccess<SubscriptionSummaryPayload>(summary.body).plan.key).toBe(
      'free',
    );

    await request(server)
      .get('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
  });

  it('never blocks a DOWNGRADE out of an uncollectable currency', async () => {
    // The case that matters most: an organization that subscribed while its currency was still
    // chargeable must always be able to leave. Blocking the exit would trap it on a plan nobody
    // can bill it for.
    const { accessToken, organizationId } = await setupOrg(
      'chargeable-eur-downgrade@korva.test',
      'FR',
      'EUR',
    );
    // Direct write, because the API would now refuse this upgrade — which is the point.
    await putOrganizationOnPlan(connection, organizationId, 'business');

    await changePlan(accessToken, organizationId, 'free').expect(201);

    const summary = await request(server)
      .get('/api/v1/subscriptions/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    expect(asSuccess<SubscriptionSummaryPayload>(summary.body).plan.key).toBe(
      'free',
    );
  });

  it('hands the business a PDF invoice from VIT GLOBAL for a 1-year plan, and no one else', async () => {
    const { accessToken, organizationId } = await setupOrg(
      'invoice-pdf-xof@korva.test',
      'CI',
      'XOF',
    );
    await request(server)
      .post('/api/v1/subscriptions/change-plan')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ planKey: 'starter', interval: 'year' })
      .expect(201);
    const list = await request(server)
      .get('/api/v1/subscriptions/invoices')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .expect(200);
    const [invoice] = asSuccess<{ id: string; amount: number }[]>(list.body);
    // 10 months of 9 900 F: the yearly price.
    expect(invoice!.amount).toBe(99000);

    const pdf = await request(server)
      .get(`/api/v1/subscriptions/invoices/${invoice!.id}/pdf`)
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .buffer(true)
      .expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');

    const other = await setupOrg('invoice-pdf-other@korva.test', 'CI', 'XOF');
    await request(server)
      .get(`/api/v1/subscriptions/invoices/${invoice!.id}/pdf`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .set('X-Organization-Id', other.organizationId)
      .expect(404);
  });
});
