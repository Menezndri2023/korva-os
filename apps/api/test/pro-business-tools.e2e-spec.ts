import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import type {
  AnalyticsInsights,
  DataExport,
  NetworkOverview,
  TillClosing,
  TillReport,
} from '@korva/types';
import { AppModule } from './../src/app.module';
import { putOrganizationOnPlan } from './support/plan-tier';
import { InvoiceReminderService } from '../src/finance/invoices/invoice-reminder.service';

/**
 * The Pro and Business tools of 2026-11-01: advanced statistics, Excel exports and the till
 * closing (Pro), the sales journal (Business). Each refused below its tier, and each computed from
 * documents written straight into the database so the figures are known in advance.
 */

interface ApiSuccess<T> {
  success: true;
  data: T;
}
function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function errorOf(body: unknown): {
  code: string;
  details?: { feature?: string };
} {
  return (body as { error: { code: string; details?: { feature?: string } } })
    .error;
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('Pro and Business tools (e2e)', () => {
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

  it('refuses each tool below its plan, then computes it from the real documents', async () => {
    const email = 'pro-tools@korva.test';
    const accessToken = asSuccess<{ accessToken: string }>(
      (
        await request(server)
          .post('/api/v1/auth/register')
          .send({ email, password: 'password123' })
          .expect(201)
      ).body,
    ).accessToken;
    const organization = asSuccess<{ id: string }>(
      (
        await request(server)
          .post('/api/v1/organizations')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            name: 'Boutique Pro',
            type: 'commerce',
            country: 'CI',
            currency: 'XOF',
            timezone: 'Africa/Abidjan',
            language: 'fr',
          })
          .expect(201)
      ).body,
    );
    const auth = (req: request.Test) =>
      req
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organization.id);
    const user = await connection.collection('users').findOne({ email });
    const orgId = new Types.ObjectId(organization.id);

    // Free: every new tool is refused, naming its feature.
    const refused: [string, string][] = [
      ['/api/v1/analytics/insights', 'advanced_analytics'],
      ['/api/v1/exports/orders', 'data_export'],
      ['/api/v1/counter-payments/till', 'cash_closing'],
    ];
    await putOrganizationOnPlan(connection, organization.id, 'pro');
    await auth(request(server).patch('/api/v1/organizations/me'))
      .send({ enabledModules: ['crm', 'catalog', 'commerce', 'analytics'] })
      .expect(200);
    await putOrganizationOnPlan(connection, organization.id, 'free');
    for (const [path, feature] of refused) {
      const res = await auth(request(server).get(path)).expect(403);
      expect(errorOf(res.body)).toMatchObject({
        code: 'PLAN_FEATURE_NOT_INCLUDED',
        details: { feature },
      });
    }

    // Data: one customer, two sales this month and one the month before.
    const now = Date.now();
    const awa = new Types.ObjectId();
    await connection.collection('contacts').insertOne({
      _id: awa,
      organizationId: orgId,
      type: 'person',
      firstName: 'Awa',
      lastName: 'Koné',
      phone: '+225 07 00 00 00 01',
      tags: [],
      createdAt: new Date(now - 2 * DAY_MS),
      updatedAt: new Date(),
    });
    const order = (
      number: string,
      total: number,
      ago: number,
      status = 'confirmed',
    ) => ({
      organizationId: orgId,
      contactId: awa,
      number,
      status,
      source: 'manual',
      items: [{ description: 'Pagne wax', quantity: 1, unitPrice: total }],
      currency: 'XOF',
      subtotal: total,
      taxTotal: 0,
      discountTotal: 0,
      shippingCost: 0,
      total,
      createdAt: new Date(now - ago * DAY_MS),
      updatedAt: new Date(),
    });
    await connection
      .collection('orders')
      .insertMany([
        order('CMD-1', 10000, 1),
        order('CMD-2', 20000, 3),
        order('CMD-3', 5000, 40),
        order('CMD-4', 99000, 2, 'cancelled'),
      ]);

    await putOrganizationOnPlan(connection, organization.id, 'pro');

    const insights = asSuccess<AnalyticsInsights>(
      (
        await auth(
          request(server).get('/api/v1/analytics/insights?days=30'),
        ).expect(200)
      ).body,
    );
    expect(insights.ordersRevenue).toEqual({ current: 30000, previous: 5000 });
    expect(insights.ordersCount).toEqual({ current: 2, previous: 1 });
    expect(insights.averageOrder.current).toBe(15000);
    expect(insights.newContacts.current).toBe(1);
    expect(insights.topCustomers[0]).toMatchObject({
      name: 'Awa Koné',
      total: 30000,
      count: 2,
    });
    expect(insights.topOffers[0]).toMatchObject({
      name: 'Pagne wax',
      total: 30000,
      quantity: 2,
    });

    // Exports: the orders of the default 30 days, Excel-ready.
    const ordersFile = asSuccess<DataExport>(
      (await auth(request(server).get('/api/v1/exports/orders')).expect(200))
        .body,
    );
    expect(ordersFile.csv.charCodeAt(0)).toBe(0xfeff);
    expect(ordersFile.csv).toContain('Date;Numéro;Client');
    expect(ordersFile.csv).toContain('CMD-1');
    expect(ordersFile.csv).not.toContain('CMD-3');
    expect(ordersFile.rows).toBe(3);
    expect(ordersFile.filename).toMatch(/-orders-.*\.csv$/);
    // The sales journal is Business.
    expect(
      errorOf(
        (
          await auth(
            request(server).get('/api/v1/exports/sales-journal'),
          ).expect(403)
        ).body,
      ),
    ).toMatchObject({ details: { feature: 'accounting_export' } });

    // Till: today's payments, by method and by staff member.
    const invoiceId = new Types.ObjectId();
    const payment = (amount: number, method: string, extra = {}) => ({
      organizationId: orgId,
      invoiceId,
      amount,
      currency: 'XOF',
      status: 'completed',
      provider: 'manual',
      method,
      refundedAmount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...extra,
    });
    await connection.collection('payments').insertMany([
      payment(3000, 'cash', { recordedBy: user!._id }),
      payment(2000, 'Espèces', { recordedBy: user!._id }),
      payment(7000, 'online', {
        idempotencyKey: `counter:${new Types.ObjectId().toString()}`,
      }),
      payment(1500, 'online', {
        status: 'pending',
        idempotencyKey: `counter:${new Types.ObjectId().toString()}`,
      }),
    ]);
    const till = asSuccess<TillReport>(
      (
        await auth(request(server).get('/api/v1/counter-payments/till')).expect(
          200,
        )
      ).body,
    );
    expect(till.total).toBe(12000);
    expect(till.count).toBe(3);
    expect(till.expectedCash).toBe(5000);
    expect(till.counterUnpaid).toBe(1);
    expect(till.byMethod.find((m) => m.method === 'cash')).toMatchObject({
      label: 'Espèces',
      total: 5000,
      count: 2,
    });
    expect(
      till.byStaff.find((s) => s.userId === user!._id.toString()),
    ).toMatchObject({
      total: 5000,
    });
    expect(till.closing).toBeNull();

    const closing = asSuccess<TillClosing>(
      (
        await auth(
          request(server).post('/api/v1/counter-payments/till/closings'),
        )
          .send({ day: till.day, countedCash: 4500, note: 'Billet abîmé' })
          .expect(201)
      ).body,
    );
    expect(closing).toMatchObject({
      expectedCash: 5000,
      countedCash: 4500,
      difference: -500,
      total: 12000,
    });
    const again = await auth(
      request(server).post('/api/v1/counter-payments/till/closings'),
    )
      .send({ day: till.day, countedCash: 5000 })
      .expect(409);
    expect(errorOf(again.body).code).toBe('TILL_ALREADY_CLOSED');
    const reread = asSuccess<TillReport>(
      (
        await auth(request(server).get('/api/v1/counter-payments/till')).expect(
          200,
        )
      ).body,
    );
    expect(reread.closing?.difference).toBe(-500);

    // Business: the sales journal, one line per sale and a VAT summary.
    await putOrganizationOnPlan(connection, organization.id, 'business');
    await connection.collection('invoices').insertOne({
      organizationId: orgId,
      contactId: awa,
      number: 'FAC-0001',
      status: 'paid',
      items: [
        { description: 'Conseil', quantity: 1, unitPrice: 10000, taxRate: 18 },
      ],
      currency: 'XOF',
      subtotal: 10000,
      taxTotal: 1800,
      discountTotal: 0,
      total: 11800,
      amountPaid: 11800,
      issuedAt: new Date(now - DAY_MS),
      createdAt: new Date(now - DAY_MS),
      updatedAt: new Date(),
    });
    const journal = asSuccess<DataExport>(
      (
        await auth(request(server).get('/api/v1/exports/sales-journal')).expect(
          200,
        )
      ).body,
    );
    expect(journal.csv).toContain('Date;Pièce;Type;Client;Montant HT;TVA');
    expect(journal.csv).toContain('FAC-0001;Facture;Awa Koné;10000;1800;11800');
    // The two orders of the period without an invoice, never the cancelled one.
    expect(journal.csv).toContain('CMD-1;Commande');
    expect(journal.csv).not.toContain('CMD-4');
    expect(journal.csv).toContain('Récapitulatif TVA');
    expect(journal.csv).toContain('18 %;10000;1800');

    // Business: the network view lists every establishment the owner runs, each with its own
    // figures — and a Pro tool stays refused for nobody on Business.
    const second = asSuccess<{ id: string }>(
      (
        await request(server)
          .post('/api/v1/organizations')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            name: 'Boutique Pro Deux',
            type: 'commerce',
            country: 'CI',
            currency: 'XOF',
            timezone: 'Africa/Abidjan',
            language: 'fr',
          })
          .expect(201)
      ).body,
    );
    const network = asSuccess<NetworkOverview>(
      (await auth(request(server).get('/api/v1/network/overview')).expect(200))
        .body,
    );
    const names = network.establishments.map((place) => place.name);
    expect(names).toEqual(['Boutique Pro', 'Boutique Pro Deux']);
    expect(
      network.establishments.find((p) => p.organizationId === organization.id),
    ).toMatchObject({ sales: 30000, orders: 2, collected: 12000 });
    expect(
      network.establishments.find((p) => p.organizationId === second.id),
    ).toMatchObject({ sales: 0, orders: 0 });
    // The second establishment is on Free: from its own context the view is refused.
    await request(server)
      .get('/api/v1/network/overview')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', second.id)
      .expect(403);
  });

  it('reminds the customer of an overdue invoice once, on Pro only', async () => {
    const email = 'reminders@korva.test';
    const accessToken = asSuccess<{ accessToken: string }>(
      (
        await request(server)
          .post('/api/v1/auth/register')
          .send({ email, password: 'password123' })
          .expect(201)
      ).body,
    ).accessToken;
    const organization = asSuccess<{ id: string }>(
      (
        await request(server)
          .post('/api/v1/organizations')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            name: 'Cabinet Relance',
            type: 'conseil',
            country: 'CI',
            currency: 'XOF',
            timezone: 'Africa/Abidjan',
            language: 'fr',
          })
          .expect(201)
      ).body,
    );
    const orgId = new Types.ObjectId(organization.id);
    const contactId = new Types.ObjectId();
    await connection.collection('contacts').insertOne({
      _id: contactId,
      organizationId: orgId,
      type: 'person',
      firstName: 'Kofi',
      email: 'kofi@client.test',
      tags: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const invoiceId = new Types.ObjectId();
    await connection.collection('invoices').insertOne({
      _id: invoiceId,
      organizationId: orgId,
      contactId,
      number: 'FAC-0042',
      status: 'overdue',
      items: [{ description: 'Audit', quantity: 1, unitPrice: 50000 }],
      currency: 'XOF',
      subtotal: 50000,
      taxTotal: 0,
      discountTotal: 0,
      total: 50000,
      amountPaid: 20000,
      dueDate: new Date(Date.now() - 2 * DAY_MS),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const reminders = app.get(InvoiceReminderService);

    // Free: nothing is sent.
    expect(
      await reminders.remindOverdue(organization.id, invoiceId.toString()),
    ).toBeUndefined();

    await putOrganizationOnPlan(connection, organization.id, 'pro');
    // No WhatsApp consent on file: the e-mail carries it.
    expect(
      await reminders.remindOverdue(organization.id, invoiceId.toString()),
    ).toBe('email');
    const invoice = await connection
      .collection('invoices')
      .findOne({ _id: invoiceId });
    expect(invoice?.reminderChannel).toBe('email');
    expect(invoice?.reminderSentAt).toBeInstanceOf(Date);
    const conversation = await connection
      .collection('conversations')
      .findOne({ organizationId: orgId, contactId, channel: 'email' });
    const message = await connection
      .collection('messages')
      .findOne({ conversationId: conversation?._id });
    expect(message?.body).toContain('Bonjour Kofi');
    expect(message?.body).toContain('FAC-0042');
    expect(message?.body).toMatch(/30\s000\sF/);

    // Once only.
    expect(
      await reminders.remindOverdue(organization.id, invoiceId.toString()),
    ).toBeUndefined();
  });

  it('offers the premium site themes on Pro, on any sector template, and never by default', async () => {
    const email = 'premium-theme@korva.test';
    const accessToken = asSuccess<{ accessToken: string }>(
      (
        await request(server)
          .post('/api/v1/auth/register')
          .send({ email, password: 'password123' })
          .expect(201)
      ).body,
    ).accessToken;
    const organization = asSuccess<{ id: string; slug: string }>(
      (
        await request(server)
          .post('/api/v1/organizations')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({
            name: 'Boutique Prestige',
            type: 'commerce',
            country: 'CI',
            currency: 'XOF',
            timezone: 'Africa/Abidjan',
            language: 'fr',
          })
          .expect(201)
      ).body,
    );
    const patch = (body: Record<string, unknown>) =>
      request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organization.id)
        .send(body);
    const theme = async () =>
      asSuccess<{
        storefrontTheme: { palette?: string; fontPairing?: string };
      }>(
        (
          await request(server)
            .get(`/api/v1/public/${organization.slug}`)
            .expect(200)
        ).body,
      ).storefrontTheme;

    await putOrganizationOnPlan(connection, organization.id, 'starter');
    await patch({
      storefrontTemplate: 'boutique',
      storefrontPalette: 'jade',
    }).expect(403);

    await putOrganizationOnPlan(connection, organization.id, 'pro');
    const before = await theme();
    expect(['ivoire', 'jade', 'bordeaux']).not.toContain(before.palette);
    expect(before.fontPairing).not.toBe('prestige');

    await patch({
      storefrontTemplate: 'boutique',
      storefrontPalette: 'jade',
      storefrontFontPairing: 'prestige',
    }).expect(200);
    expect(await theme()).toMatchObject({
      palette: 'jade',
      fontPairing: 'prestige',
    });

    // Back on Starter the site falls back to its template's own look, nothing is deleted.
    await putOrganizationOnPlan(connection, organization.id, 'starter');
    const after = await theme();
    expect(after.palette).not.toBe('jade');
    expect(after.fontPairing).not.toBe('prestige');
  });
});
