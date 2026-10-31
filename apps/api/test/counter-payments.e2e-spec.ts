import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { IntegrationsService } from './../src/integrations/integrations.service';
import { IntegrationsRepository } from './../src/integrations/integrations.repository';

interface ApiSuccess<T> {
  success: true;
  data: T;
}
function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
interface CounterPayment {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  label: string;
  amount: number;
  currency: string;
  status: string;
  checkoutUrl?: string;
}

/**
 * The counter QR code end to end, against a stand-in GeniusPay: staff type an amount, get
 * GeniusPay's payment page to show as a QR code, the cashier's screen sees the payment go
 * through, the invoice is paid and the Solde KORVA is credited — on the Free plan.
 */
describe('Caisse — QR mobile money (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let created = 0;
  const lastPaymentBody: { value?: Record<string, unknown> } = {};

  const stub: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const url = req.url ?? '';
      if (req.method === 'POST' && url === '/payments') {
        created += 1;
        lastPaymentBody.value = JSON.parse(raw) as Record<string, unknown>;
        res.end(
          JSON.stringify({
            success: true,
            data: {
              reference: `MTX-C${created}`,
              status: 'pending',
              checkout_url: `https://pay.genius.ci/c/MTX-C${created}`,
            },
          }),
        );
      } else if (req.method === 'GET' && url.startsWith('/payments/')) {
        const reference = url.slice('/payments/'.length);
        // The first sale is paid; every later one is still waiting for the customer.
        res.end(
          JSON.stringify({
            success: true,
            data:
              reference === 'MTX-C1'
                ? { reference, status: 'completed', fees: 150 }
                : { reference, status: 'pending' },
          }),
        );
      } else {
        res.end(JSON.stringify({ success: true, data: {} }));
      }
    });
  });

  beforeAll(async () => {
    await new Promise<void>((resolve) => stub.listen(0, '127.0.0.1', resolve));
    const { port } = stub.address() as AddressInfo;
    Object.assign(process.env, {
      GENIUSPAY_API_BASE_URL: `http://127.0.0.1:${port}`,
      GENIUSPAY_WEBHOOK_SECRET: 'whsec_counter',
      WALLET_HOLD_DAYS: '0',
    });
    const { AppModule } = await import('./../src/app.module');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
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
    const account = await app.get(IntegrationsService).createPlatformAccount({
      domain: 'payment',
      provider: 'geniuspay',
      role: 'merchant-of-record',
      market: null,
      secret: 'pk_live_c sk_live_c',
    });
    await app.get(IntegrationsRepository).updateStatus(account.id, 'active');
  }, 120_000);

  afterAll(async () => {
    for (const key of [
      'GENIUSPAY_API_BASE_URL',
      'GENIUSPAY_WEBHOOK_SECRET',
      'WALLET_HOLD_DAYS',
    ]) {
      delete process.env[key];
    }
    await connection.dropDatabase();
    await app.close();
    await new Promise((resolve) => stub.close(resolve));
  });

  async function business(email: string, currency: string) {
    const token = asSuccess<{ accessToken: string }>(
      (
        await request(server)
          .post('/api/v1/auth/register')
          .send({ email, password: 'password123' })
          .expect(201)
      ).body,
    ).accessToken;
    const org = asSuccess<{ id: string; slug: string }>(
      (
        await request(server)
          .post('/api/v1/organizations')
          .set('Authorization', `Bearer ${token}`)
          .send({
            name: `Salon ${currency}`,
            type: 'services',
            country: currency === 'XOF' ? 'CI' : 'MA',
            currency,
            timezone: 'Africa/Abidjan',
            language: 'fr',
          })
          .expect(201)
      ).body,
    );
    return {
      org,
      staff: (req: request.Test) =>
        req
          .set('Authorization', `Bearer ${token}`)
          .set('X-Organization-Id', org.id),
    };
  }

  let staff: (req: request.Test) => request.Test;
  let organizationId: string;
  let first: CounterPayment;

  it('creates a mobile money payment page for the amount typed at the counter', async () => {
    const shop = await business('owner@salon.ci', 'XOF');
    staff = shop.staff;
    organizationId = shop.org.id;

    first = asSuccess<CounterPayment>(
      (
        await staff(request(server).post('/api/v1/counter-payments'))
          .send({ amount: 5000, label: 'Coupe homme' })
          .expect(201)
      ).body,
    );
    expect(first).toMatchObject({
      label: 'Coupe homme',
      amount: 5000,
      currency: 'XOF',
      status: 'pending',
      checkoutUrl: 'https://pay.genius.ci/c/MTX-C1',
    });
    expect(first.invoiceNumber).not.toBe('');
    // No e-mail at the counter: GeniusPay's page asks the customer for their number itself.
    expect(lastPaymentBody.value).toMatchObject({
      amount: 5000,
      currency: 'XOF',
    });
    expect(lastPaymentBody.value).not.toHaveProperty('customer');
    expect(String(lastPaymentBody.value?.success_url)).toContain(shop.org.slug);
  });

  it('sees the payment go through, pays the invoice and credits the Solde', async () => {
    const checked = asSuccess<CounterPayment>(
      (
        await staff(
          request(server).get(`/api/v1/counter-payments/${first.id}`),
        ).expect(200)
      ).body,
    );
    expect(checked.status).toBe('completed');

    // Read directly: the Finance module (and its invoice screens) need not be on to use the counter.
    const invoice = await connection
      .collection('invoices')
      .findOne({ _id: new Types.ObjectId(first.invoiceId) });
    expect(invoice).toMatchObject({
      status: 'paid',
      total: 5000,
      amountPaid: 5000,
    });

    // 5 000 − 150 (GeniusPay) − 150 (3 % on Free) = 4 700
    const wallet = asSuccess<{ available: number }>(
      (await staff(request(server).get('/api/v1/wallet')).expect(200)).body,
    );
    expect(wallet.available).toBe(4700);
  });

  it('keeps waiting while the customer has not paid, and lists the counter sales', async () => {
    const second = asSuccess<CounterPayment>(
      (
        await staff(request(server).post('/api/v1/counter-payments'))
          .send({ amount: 2500 })
          .expect(201)
      ).body,
    );
    expect(second.label).toBe('Vente au comptoir');
    const checked = asSuccess<CounterPayment>(
      (
        await staff(
          request(server).get(`/api/v1/counter-payments/${second.id}`),
        ).expect(200)
      ).body,
    );
    expect(checked.status).toBe('pending');

    const list = asSuccess<CounterPayment[]>(
      (await staff(request(server).get('/api/v1/counter-payments')).expect(200))
        .body,
    );
    expect(list.map((p) => [p.amount, p.status])).toEqual([
      [2500, 'pending'],
      [5000, 'completed'],
    ]);

    // Both sales are invoiced to one "Client au comptoir", not a new contact each time.
    expect(
      await connection.collection('contacts').countDocuments({
        organizationId: new Types.ObjectId(organizationId),
        tags: 'client-comptoir',
      }),
    ).toBe(1);
  });

  it('only shows counter sales, and only the business’s own', async () => {
    await staff(
      request(server).get(
        `/api/v1/counter-payments/${new Types.ObjectId().toString()}`,
      ),
    ).expect(404);
    await staff(
      request(server).get('/api/v1/counter-payments/not-an-id'),
    ).expect(404);

    const other = await business('owner@autre.ci', 'XOF');
    await other
      .staff(request(server).get(`/api/v1/counter-payments/${first.id}`))
      .expect(404);
    const list = asSuccess<CounterPayment[]>(
      (
        await other
          .staff(request(server).get('/api/v1/counter-payments'))
          .expect(200)
      ).body,
    );
    expect(list).toEqual([]);
  });

  it('refuses an amount of zero, and a currency GeniusPay cannot charge', async () => {
    await staff(request(server).post('/api/v1/counter-payments'))
      .send({ amount: 0 })
      .expect(400);

    const moroccan = await business('owner@salon.ma', 'MAD');
    const res = await moroccan
      .staff(request(server).post('/api/v1/counter-payments'))
      .send({ amount: 100 })
      .expect(400);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'CURRENCY_NOT_CHARGEABLE',
    );
  });
});
