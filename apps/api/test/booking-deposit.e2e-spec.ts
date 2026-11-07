import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { ONLINE_PAYMENT_TERMS_VERSION } from '@korva/types';
import { putOrganizationOnPlan } from './support/plan-tier';
import { IntegrationsService } from './../src/integrations/integrations.service';
import { IntegrationsRepository } from './../src/integrations/integrations.repository';
import { BookingsService } from './../src/booking/bookings/bookings.service';

interface ApiSuccess<T> {
  success: true;
  data: T;
}
const asSuccess = <T>(body: unknown) => (body as ApiSuccess<T>).data;

function nextMonday(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 7);
  while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/**
 * Acompte en ligne: an offer asking a 30 % deposit sends the customer to GeniusPay for that
 * share only; paid, the booking's invoice is partly paid and the tracking page says so; never
 * paid, the slot is freed after the payment window.
 */
describe('Booking deposit (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;
  let slug: string;
  let resourceId: string;
  let offerId: string;
  let created = 0;
  const paid = new Set<string>();
  const amounts: number[] = [];
  const monday = nextMonday();

  const stub: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk: Buffer) => (raw += chunk.toString()));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      const url = req.url ?? '';
      if (req.method === 'POST' && url === '/payments') {
        created += 1;
        amounts.push((JSON.parse(raw) as { amount: number }).amount);
        res.end(
          JSON.stringify({
            success: true,
            data: {
              reference: `MTX-D${created}`,
              status: 'pending',
              checkout_url: `https://pay.genius.ci/c/MTX-D${created}`,
            },
          }),
        );
      } else if (req.method === 'GET' && url.startsWith('/payments/')) {
        const reference = url.slice('/payments/'.length);
        res.end(
          JSON.stringify({
            success: true,
            data: paid.has(reference)
              ? { reference, status: 'completed', fees: 175 }
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
      GENIUSPAY_WEBHOOK_SECRET: 'whsec_deposit',
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
      secret: 'pk_live_d sk_live_d',
    });
    await app.get(IntegrationsRepository).updateStatus(account.id, 'active');

    const token = asSuccess<{ accessToken: string }>(
      (
        await request(server)
          .post('/api/v1/auth/register')
          .send({ email: 'owner@salon-acompte.ci', password: 'password123' })
          .expect(201)
      ).body,
    ).accessToken;
    const org = asSuccess<{ id: string; slug: string }>(
      (
        await request(server)
          .post('/api/v1/organizations')
          .set('Authorization', `Bearer ${token}`)
          .send({
            name: 'Salon Acompte',
            type: 'beauté',
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
        enabledModules: ['crm', 'catalog', 'booking', 'finance', 'website'],
        acceptedPaymentMethods: ['cash', 'online'],
        acceptOnlinePaymentTerms: ONLINE_PAYMENT_TERMS_VERSION,
      })
      .expect(200);
    resourceId = asSuccess<{ id: string }>(
      (
        await staff(request(server).post('/api/v1/resources'))
          .send({
            name: 'Fauteuil 1',
            type: 'chair',
            weeklyAvailability: [
              { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
            ],
          })
          .expect(201)
      ).body,
    ).id;
    offerId = asSuccess<{ id: string }>(
      (
        await staff(request(server).post('/api/v1/offers'))
          .send({
            type: 'booking',
            name: 'Tresses africaines',
            status: 'active',
            durationMinutes: 60,
            depositPercent: 30,
            pricing: { amount: 10000, currency: 'XOF' },
          })
          .expect(201)
      ).body,
    ).id;
  }, 120_000);

  afterAll(async () => {
    await connection.dropDatabase();
    await app.close();
    await new Promise<void>((resolve) => stub.close(() => resolve()));
  });

  const book = (hour: string, email: string) =>
    request(server)
      .post(`/api/v1/public/${slug}/bookings`)
      .send({
        resourceId,
        offerId,
        startAt: `${monday}T${hour}:00:00.000Z`,
        endAt: `${monday}T${String(Number(hour) + 1).padStart(2, '0')}:00:00.000Z`,
        contact: { email, firstName: 'Awa' },
      })
      .expect(201);
  const track = async (id: string, email: string) =>
    asSuccess<{ deposit?: { amount: number; status: string } }>(
      (
        await request(server)
          .get(`/api/v1/public/${slug}/bookings/${id}`)
          .query({ email })
          .expect(200)
      ).body,
    ).deposit;

  it('asks the deposit share only, online, and says on the tracking page when it is paid', async () => {
    const booking = asSuccess<{
      id: string;
      checkoutUrl?: string;
      depositAmount?: number;
    }>((await book('09', 'awa@example.com')).body);
    expect(booking.depositAmount).toBe(3000);
    expect(booking.checkoutUrl).toBe('https://pay.genius.ci/c/MTX-D1');
    expect(amounts).toEqual([3000]);
    expect(await track(booking.id, 'awa@example.com')).toEqual({
      amount: 3000,
      status: 'pending',
    });

    paid.add('MTX-D1');
    expect(await track(booking.id, 'awa@example.com')).toEqual({
      amount: 3000,
      status: 'paid',
    });
    const order = await connection
      .collection('orders')
      .findOne({ bookingId: new Types.ObjectId(booking.id) });
    const invoice = await connection
      .collection('invoices')
      .findOne({ _id: order!.invoiceId as Types.ObjectId });
    expect(invoice).toMatchObject({
      total: 10000,
      amountPaid: 3000,
      status: 'partially_paid',
    });
  });

  it('frees the slot of a deposit never paid once its window has passed', async () => {
    const booking = asSuccess<{ id: string }>(
      (await book('11', 'kofi@example.com')).body,
    );
    await app.get(BookingsService).releaseUnpaidDeposits();
    expect(
      (
        await connection
          .collection('bookings')
          .findOne({ _id: new Types.ObjectId(booking.id) })
      )?.status,
    ).not.toBe('cancelled');

    await connection
      .collection('bookings')
      .updateOne(
        { _id: new Types.ObjectId(booking.id) },
        { $set: { depositDueBy: new Date(Date.now() - 60_000) } },
      );
    expect(await app.get(BookingsService).releaseUnpaidDeposits()).toBe(1);
    expect(
      (
        await connection
          .collection('bookings')
          .findOne({ _id: new Types.ObjectId(booking.id) })
      )?.status,
    ).toBe('cancelled');
  });
});
