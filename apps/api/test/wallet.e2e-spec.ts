import { createHmac } from 'node:crypto';
import { ONLINE_PAYMENT_TERMS_VERSION } from '@korva/types';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { putOrganizationOnPlan } from './support/plan-tier';
import { IntegrationsService } from './../src/integrations/integrations.service';
import { IntegrationsRepository } from './../src/integrations/integrations.repository';
import { PlatformAdminAuthService } from './../src/platform-admin/platform-admin-auth.service';
import { EMAIL_PROVIDER } from './../src/communication/providers/email-provider.interface';
import { WalletService } from './../src/finance/wallet/wallet.service';

interface ApiSuccess<T> {
  success: true;
  data: T;
}
function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
interface Summary {
  available: number;
  pending: number;
  openPayout: { id: string; status: string } | null;
  manualPayoutsLeftThisWeek: number | null;
}

const WEBHOOK_SECRET = 'whsec_wallet';

/**
 * Le Solde KORVA end to end, against a stand-in GeniusPay: a storefront sale credits the
 * business (minus GeniusPay's real fee and the plan's commission), a withdrawal number is
 * confirmed by e-mailed code, a withdrawal is approved and paid, a refused one is given back, two
 * cannot be open at once, and automatic withdrawals run from the sweep.
 */
describe('Solde KORVA (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  const emails: { to: string; body: string }[] = [];
  const payoutStatus: Record<string, string> = {};
  let payoutCount = 0;

  const stub: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const url = req.url ?? '';
      if (req.method === 'POST' && url === '/payments') {
        res.end(
          JSON.stringify({
            success: true,
            data: {
              reference: 'MTX-WALLET01',
              status: 'pending',
              checkout_url: 'https://pay.genius.ci/c/MTX-WALLET01',
            },
          }),
        );
      } else if (req.method === 'GET' && url === '/payments/MTX-WALLET01') {
        res.end(
          JSON.stringify({
            success: true,
            data: { reference: 'MTX-WALLET01', status: 'completed', fees: 450 },
          }),
        );
      } else if (req.method === 'POST' && url === '/payouts') {
        payoutCount += 1;
        const reference = `PYT-${payoutCount}`;
        payoutStatus[reference] = 'pending';
        res.end(
          JSON.stringify({
            success: true,
            data: {
              reference,
              status: 'pending',
              fees: 150,
              amount: (JSON.parse(raw) as { amount: number }).amount,
            },
          }),
        );
      } else if (req.method === 'GET' && url.startsWith('/payouts/')) {
        const reference = url.slice('/payouts/'.length);
        res.end(
          JSON.stringify({
            success: true,
            data: {
              reference,
              status: payoutStatus[reference] ?? 'pending',
              fees: 150,
            },
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
      GENIUSPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
      GENIUSPAY_PAYOUT_WALLET_ID: 'wallet-e2e',
      WALLET_HOLD_DAYS: '0',
      PLATFORM_ADMIN_EMAILS: 'wallet-ops@korva.test',
    });
    const { AppModule } = await import('./../src/app.module');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EMAIL_PROVIDER)
      .useValue({
        send: (message: { to: string; body: string }) => {
          emails.push(message);
          return Promise.resolve();
        },
      })
      .compile();
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
  }, 120_000);

  afterAll(async () => {
    for (const key of [
      'GENIUSPAY_API_BASE_URL',
      'GENIUSPAY_WEBHOOK_SECRET',
      'GENIUSPAY_PAYOUT_WALLET_ID',
      'WALLET_HOLD_DAYS',
      'PLATFORM_ADMIN_EMAILS',
    ]) {
      delete process.env[key];
    }
    await connection.dropDatabase();
    await app.close();
    await new Promise((resolve) => stub.close(resolve));
  });

  let organizationId: string;
  let staff: (req: request.Test) => request.Test;
  let adminToken: string;
  const admin = (req: request.Test) =>
    req.set('Authorization', `Bearer ${adminToken}`);

  async function summary(): Promise<Summary> {
    return asSuccess<Summary>(
      (await staff(request(server).get('/api/v1/wallet')).expect(200)).body,
    );
  }

  function deliver(body: object) {
    const raw = JSON.stringify(body);
    const timestamp = Math.floor(Date.now() / 1000);
    return request(server)
      .post('/api/v1/webhooks/geniuspay')
      .set('Content-Type', 'application/json')
      .set(
        'X-Webhook-Signature',
        createHmac('sha256', WEBHOOK_SECRET)
          .update(`${timestamp}.${raw}`)
          .digest('hex'),
      )
      .set('X-Webhook-Timestamp', String(timestamp))
      .send(raw);
  }

  it('credits a storefront sale: amount − GeniusPay’s real fee − the plan’s commission', async () => {
    const account = await app.get(IntegrationsService).createPlatformAccount({
      domain: 'payment',
      provider: 'geniuspay',
      role: 'merchant-of-record',
      market: null,
      secret: 'pk_live_w sk_live_w',
    });
    await app.get(IntegrationsRepository).updateStatus(account.id, 'active');
    const { password } = await app
      .get(PlatformAdminAuthService)
      .provision('wallet-ops@korva.test');
    adminToken = asSuccess<{ accessToken: string }>(
      (
        await request(server)
          .post('/api/v1/platform/auth/login')
          .send({ email: 'wallet-ops@korva.test', password })
          .expect(200)
      ).body,
    ).accessToken;

    const token = asSuccess<{ accessToken: string }>(
      (
        await request(server)
          .post('/api/v1/auth/register')
          .send({ email: 'owner@boutique.ci', password: 'password123' })
          .expect(201)
      ).body,
    ).accessToken;
    const org = asSuccess<{ id: string; slug: string }>(
      (
        await request(server)
          .post('/api/v1/organizations')
          .set('Authorization', `Bearer ${token}`)
          .send({
            name: 'Boutique Awa',
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
    await putOrganizationOnPlan(connection, org.id, 'starter');
    staff = (req) =>
      req
        .set('Authorization', `Bearer ${token}`)
        .set('X-Organization-Id', org.id);
    await staff(request(server).patch('/api/v1/organizations/me'))
      .send({
        enabledModules: ['crm', 'catalog', 'commerce', 'finance', 'website'],
        acceptedPaymentMethods: ['cash', 'online'],
        acceptOnlinePaymentTerms: ONLINE_PAYMENT_TERMS_VERSION,
      })
      .expect(200);
    const contact = asSuccess<{ id: string }>(
      (
        await staff(request(server).post('/api/v1/contacts'))
          .send({
            type: 'person',
            firstName: 'Fatou',
            email: 'fatou@example.com',
          })
          .expect(201)
      ).body,
    );
    const order = asSuccess<{ id: string }>(
      (
        await staff(request(server).post('/api/v1/orders'))
          .send({
            contactId: contact.id,
            currency: 'XOF',
            items: [{ description: 'Pagne', quantity: 1, unitPrice: 15000 }],
          })
          .expect(201)
      ).body,
    );
    await request(server)
      .post(`/api/v1/public/${org.slug}/orders/${order.id}/pay`)
      .send({ email: 'fatou@example.com' })
      .expect(201);
    await deliver({
      id: 'evt-sale',
      event: 'payment.success',
      data: { reference: 'MTX-WALLET01' },
    }).expect(200);

    // 15 000 − 450 (GeniusPay) − 300 (2 % Starter) = 14 250, released at once (WALLET_HOLD_DAYS=0)
    expect(await summary()).toMatchObject({ available: 14250, pending: 0 });
    // The owner hears of it by e-mail, not only by opening the dashboard.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(
      emails.some(
        (mail) =>
          mail.to === 'owner@boutique.ci' &&
          (mail as { subject?: string }).subject?.startsWith(
            'Paiement en ligne reçu',
          ),
      ),
    ).toBe(true);
    const entries = asSuccess<{ kind: string; amount: number }[]>(
      (await staff(request(server).get('/api/v1/wallet/entries')).expect(200))
        .body,
    );
    expect(entries.map((e) => [e.kind, e.amount]).sort()).toEqual(
      [
        ['commission', -300],
        ['provider_fee', -450],
        ['sale', 15000],
      ].sort(),
    );

    // Credited once only: the sweep finds nothing left to do.
    expect((await app.get(WalletService).runSweep()).credited).toBe(0);
  });

  it('gives the month as a statement — JSON, Excel CSV and PDF', async () => {
    const month = new Date().toISOString().slice(0, 7);
    const statement = asSuccess<{
      opening: number;
      closing: number;
      totals: { kind: string; amount: number }[];
    }>(
      (
        await staff(request(server).get('/api/v1/wallet/statement'))
          .query({ month })
          .expect(200)
      ).body,
    );
    expect(statement.opening).toBe(0);
    expect(statement.closing).toBe(14250);
    expect(statement.totals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'sale', amount: 15000 }),
        expect.objectContaining({ kind: 'commission', amount: -300 }),
      ]),
    );
    const csv = await staff(
      request(server).get('/api/v1/wallet/statement/download'),
    )
      .query({ month, format: 'csv' })
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(String(csv.text)).toContain('Vente payée en ligne');
    const pdf = await staff(
      request(server).get('/api/v1/wallet/statement/download'),
    )
      .query({ month, format: 'pdf' })
      .buffer(true)
      .expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    await staff(request(server).get('/api/v1/wallet/statement'))
      .query({ month: '2026-13' })
      .expect(400);
  });

  it('refunds a customer of an online sale: taken off the Solde, sent by KORVA by hand', async () => {
    const payment = await connection
      .collection('payments')
      .findOne({ providerReference: 'MTX-WALLET01' });
    const before = (await summary()).available;
    const refund = asSuccess<{ id: string; status: string }>(
      (
        await staff(request(server).post('/api/v1/payments/refunds'))
          .set('Idempotency-Key', 'refund-test-1')
          .send({
            paymentId: String(payment!._id),
            amount: 1000,
            reason: 'Taille trop petite',
          })
          .expect(201)
      ).body,
    );
    expect(refund.status).toBe('processing');
    expect((await summary()).available).toBe(before - 1000);

    const list = asSuccess<
      { id: string; customer: { email?: string }; providerReference?: string }[]
    >(
      (await admin(request(server).get('/api/v1/platform/refunds')).expect(200))
        .body,
    );
    expect(list[0]).toMatchObject({
      id: refund.id,
      providerReference: 'MTX-WALLET01',
      customer: { email: 'fatou@example.com' },
    });

    await admin(
      request(server).post(`/api/v1/platform/refunds/${refund.id}/mark-sent`),
    )
      .send({ reference: 'WAVE-R1' })
      .expect(200);
    const stored = await connection
      .collection('refunds')
      .findOne({ _id: new Types.ObjectId(refund.id) });
    expect(stored).toMatchObject({
      status: 'completed',
      manualReference: 'WAVE-R1',
    });
    expect(
      (await connection.collection('payments').findOne({ _id: payment!._id }))
        ?.refundedAmount,
    ).toBe(1000);
    // Never twice, and the Solde is debited once.
    await admin(
      request(server).post(`/api/v1/platform/refunds/${refund.id}/mark-sent`),
    )
      .send({ reference: 'WAVE-R1' })
      .expect(400);
    expect((await summary()).available).toBe(before - 1000);

    // A refused refund gives the amount back.
    const second = asSuccess<{ id: string }>(
      (
        await staff(request(server).post('/api/v1/payments/refunds'))
          .set('Idempotency-Key', 'refund-test-2')
          .send({ paymentId: String(payment!._id), amount: 500 })
          .expect(201)
      ).body,
    );
    await admin(
      request(server).post(`/api/v1/platform/refunds/${second.id}/reject`),
    )
      .send({ reason: 'Doublon de la première demande' })
      .expect(200);
    expect((await summary()).available).toBe(before - 1000);

    // Back to the balance the next tests start from.
    await admin(
      request(server).post(
        `/api/v1/platform/organizations/${organizationId}/wallet/adjustments`,
      ),
    )
      .send({ amount: 1000, note: 'Remise à niveau du test' })
      .expect(200);
  });

  it('refuses a withdrawal before a number is confirmed by the e-mailed code', async () => {
    const res = await staff(request(server).post('/api/v1/wallet/payouts'))
      .send({})
      .expect(400);
    expect((res.body as { error: { code: string } }).error.code).toBe(
      'PAYOUT_DESTINATION_MISSING',
    );

    await staff(request(server).put('/api/v1/wallet/destination'))
      .send({
        provider: 'wave',
        account: '+225 07 07 07 07 07',
        holderName: 'Awa Koné',
      })
      .expect(200);
    const code = /(\d{6})/.exec(emails.at(-1)!.body)![1]!;
    expect(emails.at(-1)!.to).toBe('owner@boutique.ci');
    const wrong = code === '000000' ? '111111' : '000000';
    await staff(request(server).post('/api/v1/wallet/destination/confirm'))
      .send({ code: wrong })
      .expect(400);
    await staff(request(server).post('/api/v1/wallet/destination/confirm'))
      .send({ code })
      .expect(200);
    expect(
      (await staff(request(server).get('/api/v1/wallet')).expect(200)).body,
    ).toMatchObject({
      data: {
        destination: { provider: 'wave', holderName: 'Awa Koné' },
        pendingDestination: null,
      },
    });
  });

  it('takes the amount off the balance when requested, and allows one open withdrawal at a time', async () => {
    const payout = asSuccess<{ id: string; status: string; amount: number }>(
      (
        await staff(request(server).post('/api/v1/wallet/payouts'))
          .send({ amount: 10000 })
          .expect(201)
      ).body,
    );
    expect(payout).toMatchObject({ status: 'requested', amount: 10000 });
    expect(await summary()).toMatchObject({
      available: 4250,
      manualPayoutsLeftThisWeek: 0,
    });

    const again = await staff(
      request(server).post('/api/v1/wallet/payouts'),
    ).send({ amount: 2000 });
    expect([403, 409]).toContain(again.status);
  });

  it('pays it once approved, and passes GeniusPay’s withdrawal fee on (Starter)', async () => {
    const [requested] = asSuccess<{ id: string }[]>(
      (
        await admin(
          request(server)
            .get('/api/v1/platform/payouts')
            .query({ status: 'requested' }),
        ).expect(200)
      ).body,
    );
    await admin(
      request(server).post(`/api/v1/platform/payouts/${requested!.id}/approve`),
    ).expect(200);
    payoutStatus['PYT-1'] = 'completed';
    await deliver({
      id: 'evt-payout-1',
      event: 'payout.completed',
      data: { payout: { reference: 'PYT-1', status: 'completed' } },
    }).expect(200);

    const payout = await connection
      .collection('payouts')
      .findOne({ _id: new Types.ObjectId(requested!.id) });
    expect(payout).toMatchObject({
      status: 'completed',
      providerReference: 'PYT-1',
      fee: 150,
    });
    expect(payout?.open).toBeUndefined();
    expect(await summary()).toMatchObject({
      available: 4100,
      openPayout: null,
    });
  });

  it('gives a refused withdrawal back to the balance', async () => {
    await connection
      .collection('payouts')
      .updateMany({}, { $set: { trigger: 'auto' } }); // free the weekly request
    const payout = asSuccess<{ id: string }>(
      (
        await staff(request(server).post('/api/v1/wallet/payouts'))
          .send({ amount: 3000 })
          .expect(201)
      ).body,
    );
    expect((await summary()).available).toBe(1100);
    await admin(
      request(server).post(`/api/v1/platform/payouts/${payout.id}/reject`),
    )
      .send({ reason: 'Numéro à vérifier' })
      .expect(200);
    expect((await summary()).available).toBe(4100);
  });

  it('records a withdrawal the administration paid by hand, with its reference and real fee', async () => {
    await connection
      .collection('payouts')
      .updateMany({}, { $set: { trigger: 'auto' } }); // free the weekly request
    const payout = asSuccess<{ id: string }>(
      (
        await staff(request(server).post('/api/v1/wallet/payouts'))
          .send({ amount: 2000 })
          .expect(201)
      ).body,
    );
    const paid = asSuccess<{ status: string; fee: number }>(
      (
        await admin(
          request(server).post(
            `/api/v1/platform/payouts/${payout.id}/mark-paid`,
          ),
        )
          .send({ reference: 'WAVE-T123456', fee: 20 })
          .expect(200)
      ).body,
    );
    expect(paid).toMatchObject({ status: 'completed', fee: 20 });
    // 4 100 − 2 000 withdrawn − 20 fee passed on (Starter).
    expect(await summary()).toMatchObject({
      available: 2080,
      openPayout: null,
    });
    // Never twice.
    await admin(
      request(server).post(`/api/v1/platform/payouts/${payout.id}/mark-paid`),
    )
      .send({ reference: 'WAVE-T123456' })
      .expect(400);

    // Back to the balance the next tests start from.
    await admin(
      request(server).post(
        `/api/v1/platform/organizations/${organizationId}/wallet/adjustments`,
      ),
    )
      .send({ amount: 2020, note: 'Remise à niveau du test' })
      .expect(200);
  });

  it('runs automatic withdrawals from the sweep — not before the new number’s cooling-off', async () => {
    await staff(request(server).patch('/api/v1/wallet/auto-payout'))
      .send({ enabled: true, frequency: 'weekly', minimum: 1000 })
      .expect(200);
    const daily = await staff(
      request(server).patch('/api/v1/wallet/auto-payout'),
    ).send({ enabled: true, frequency: 'daily', minimum: 1000 });
    expect(daily.status).toBe(403); // daily is Pro and Business

    expect((await app.get(WalletService).runSweep()).automatic).toBe(0); // number confirmed minutes ago
    await connection.collection('wallet_settings').updateOne(
      { organizationId: new Types.ObjectId(organizationId) },
      {
        $set: {
          destinationConfirmedAt: new Date(Date.now() - 3 * 86_400_000),
        },
      },
    );
    expect((await app.get(WalletService).runSweep()).automatic).toBe(1);
    const auto = await connection
      .collection('payouts')
      .findOne({ trigger: 'auto', status: 'requested' });
    expect(auto).toMatchObject({ amount: 4100 });
    expect((await summary()).available).toBe(0);
  });

  it('shows the administration what KORVA holds and what it earned', async () => {
    const overview = asSuccess<Record<string, unknown>>(
      (
        await admin(
          request(server).get('/api/v1/platform/wallets/overview'),
        ).expect(200)
      ).body,
    );
    expect(overview).toMatchObject({
      commissionThisMonth: 300,
      payoutsToApprove: 1,
      approvalMode: 'manual',
    });
    // The business cannot reach the administration's routes.
    await staff(request(server).get('/api/v1/platform/payouts')).expect(403);
  });

  it('pays a KORVA plan invoice from the balance — once, and never beyond it', async () => {
    await admin(
      request(server).post(
        `/api/v1/platform/organizations/${organizationId}/wallet/adjustments`,
      ),
    )
      .send({ amount: 12000, note: 'Test du paiement de formule' })
      .expect(200);
    const subscription = await connection
      .collection('subscriptions')
      .findOne({ organizationId: new Types.ObjectId(organizationId) });
    const invoice = (number: string) => {
      const now = new Date();
      return connection.collection('subscription_invoices').insertOne({
        organizationId: new Types.ObjectId(organizationId),
        subscriptionId: subscription!._id,
        planId: subscription!.planId,
        number,
        status: 'open',
        periodStart: now,
        periodEnd: new Date(now.getTime() + 30 * 86_400_000),
        amount: 9900,
        currency: 'XOF',
        issuedAt: now,
        dueAt: now,
        paidAt: null,
        createdAt: now,
        updatedAt: now,
      });
    };

    const first = (await invoice('ABO-WALLET-1')).insertedId.toString();
    await staff(
      request(server).post(
        `/api/v1/subscriptions/invoices/${first}/pay-from-wallet`,
      ),
    ).expect(200);
    expect(
      (
        await connection
          .collection('subscription_invoices')
          .findOne({ number: 'ABO-WALLET-1' })
      )?.status,
    ).toBe('paid');
    expect((await summary()).available).toBe(2100);

    const again = await staff(
      request(server).post(
        `/api/v1/subscriptions/invoices/${first}/pay-from-wallet`,
      ),
    ).expect(422);
    expect((again.body as { error: { code: string } }).error.code).toBe(
      'SUBSCRIPTION_INVOICE_NOT_PAYABLE',
    );

    const second = (await invoice('ABO-WALLET-2')).insertedId.toString();
    const short = await staff(
      request(server).post(
        `/api/v1/subscriptions/invoices/${second}/pay-from-wallet`,
      ),
    ).expect(422);
    expect((short.body as { error: { code: string } }).error.code).toBe(
      'WALLET_INSUFFICIENT_BALANCE',
    );
    expect(
      (
        await connection
          .collection('subscription_invoices')
          .findOne({ number: 'ABO-WALLET-2' })
      )?.status,
    ).toBe('open');
    expect((await summary()).available).toBe(2100);
  });
});
