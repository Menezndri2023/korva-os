import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

interface ApiSuccess<T> {
  success: true;
  data: T;
}
interface ApiError {
  success: false;
  error: { code: string; message: string };
}

interface AuthPayload {
  accessToken: string;
}
interface OrganizationPayload {
  id: string;
}
interface ContactPayload {
  id: string;
}
interface TimeEntryPayload {
  id: string;
  status: string;
  contactId: string;
  currency: string;
  durationMinutes: number;
  hourlyRate?: number;
  invoiceId?: string;
}
interface InvoicePayload {
  id: string;
  items: { description: string; quantity: number; unitPrice: number }[];
  subtotal: number;
  total: number;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

// Split into its own file for the same reason expenses.e2e-spec.ts / commerce.e2e-spec.ts are
// split — each e2e spec file boots its own app and gets its own AUTH_THROTTLE budget.
describe('Time Entries module (e2e)', () => {
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

  async function registerOrgAndContact(email: string, orgName: string) {
    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123' })
      .expect(201);
    const accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: orgName,
        type: 'services professionnels',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    const organizationId = asSuccess<OrganizationPayload>(orgRes.body).id;

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ enabledModules: ['crm', 'finance'] })
      .expect(200);

    const contactRes = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ firstName: 'Client', lastName: 'Test' })
      .expect(201);
    const contactId = asSuccess<ContactPayload>(contactRes.body).id;

    return { accessToken, organizationId, contactId };
  }

  describe('Time entries module', () => {
    let accessToken: string;
    let organizationId: string;
    let contactId: string;

    beforeAll(async () => {
      ({ accessToken, organizationId, contactId } = await registerOrgAndContact(
        'time-entries-owner@korva.test',
        'Time Entries Org',
      ));
    });

    function createEntryReq(overrides: Record<string, unknown> = {}) {
      return request(server)
        .post('/api/v1/time-entries')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          date: new Date().toISOString(),
          durationMinutes: 90,
          description: 'Consulting session',
          billable: true,
          hourlyRate: 120,
          currency: 'EUR',
          ...overrides,
        });
    }

    async function createApprovedEntry(
      overrides: Record<string, unknown> = {},
    ): Promise<TimeEntryPayload> {
      const createRes = await createEntryReq(overrides).expect(201);
      const entry = asSuccess<TimeEntryPayload>(createRes.body);
      const approveRes = await request(server)
        .post(`/api/v1/time-entries/${entry.id}/approve`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      return asSuccess<TimeEntryPayload>(approveRes.body);
    }

    it('creates a time entry with server-default "unbilled" status', async () => {
      const res = await createEntryReq().expect(201);
      const entry = asSuccess<TimeEntryPayload>(res.body);
      expect(entry.status).toBe('unbilled');
      expect(entry.durationMinutes).toBe(90);
    });

    it('rejects a non-integer or negative duration', async () => {
      const res = await createEntryReq({ durationMinutes: 45.5 }).expect(400);
      expect(asError(res.body).code).toBe('VALIDATION_ERROR');
      const negRes = await createEntryReq({ durationMinutes: -10 }).expect(400);
      expect(asError(negRes.body).code).toBe('VALIDATION_ERROR');
    });

    it('rejects a billable entry with no hourlyRate and no resolvable default (TIME_ENTRY_RATE_REQUIRED)', async () => {
      const res = await createEntryReq({ hourlyRate: undefined }).expect(400);
      expect(asError(res.body).code).toBe('TIME_ENTRY_RATE_REQUIRED');
    });

    it('allows a non-billable entry with no hourlyRate', async () => {
      const res = await createEntryReq({
        billable: false,
        hourlyRate: undefined,
      }).expect(201);
      expect(asSuccess<TimeEntryPayload>(res.body).status).toBe('unbilled');
    });

    describe('default hourly rate resolution', () => {
      it("uses the client's defaultHourlyRate when none is provided", async () => {
        const rateContactRes = await request(server)
          .post('/api/v1/contacts')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .send({
            firstName: 'Rated',
            lastName: 'Client',
            defaultHourlyRate: 95,
          })
          .expect(201);
        const ratedContactId = asSuccess<ContactPayload>(
          rateContactRes.body,
        ).id;

        const res = await createEntryReq({
          contactId: ratedContactId,
          hourlyRate: undefined,
        }).expect(201);
        expect(asSuccess<TimeEntryPayload>(res.body).hourlyRate).toBe(95);
      });

      it("falls back to the caller's own default rate when the client has none", async () => {
        // Member updates are id-addressed (no 'me' shortcut route), so the caller's own
        // membership id has to be resolved via the members list first.
        const membersRes = await request(server)
          .get('/api/v1/organizations/me/members')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .expect(200);
        const members = asSuccess<
          { id: string; userId: string | { id: string; email: string } }[]
        >(membersRes.body);
        const ownerMembership = members.find((m) =>
          typeof m.userId === 'string'
            ? true
            : m.userId.email === 'time-entries-owner@korva.test',
        );
        if (!ownerMembership) throw new Error('Owner membership not found');

        await request(server)
          .patch(`/api/v1/organizations/me/members/${ownerMembership.id}/rate`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .send({ defaultHourlyRate: 60 })
          .expect(200);

        const res = await createEntryReq({ hourlyRate: undefined }).expect(201);
        expect(asSuccess<TimeEntryPayload>(res.body).hourlyRate).toBe(60);
      });
    });

    it('lists and reads back the created entry', async () => {
      const createRes = await createEntryReq({
        description: 'Listable entry',
      }).expect(201);
      const entryId = asSuccess<TimeEntryPayload>(createRes.body).id;

      const listRes = await request(server)
        .get('/api/v1/time-entries')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const list = asSuccess<TimeEntryPayload[]>(listRes.body);
      expect(list.some((e) => e.id === entryId)).toBe(true);

      const getRes = await request(server)
        .get(`/api/v1/time-entries/${entryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<TimeEntryPayload>(getRes.body).id).toBe(entryId);
    });

    it('updates an unbilled entry, then rejects editing once approved', async () => {
      const createRes = await createEntryReq({
        description: 'To be updated',
      }).expect(201);
      const entryId = asSuccess<TimeEntryPayload>(createRes.body).id;

      const updateRes = await request(server)
        .patch(`/api/v1/time-entries/${entryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ description: 'Updated description' })
        .expect(200);
      expect(asSuccess<TimeEntryPayload>(updateRes.body)).toMatchObject({
        id: entryId,
      });

      await request(server)
        .post(`/api/v1/time-entries/${entryId}/approve`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);

      const editAfterApproveRes = await request(server)
        .patch(`/api/v1/time-entries/${entryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ description: 'Should be rejected' })
        .expect(400);
      expect(asError(editAfterApproveRes.body).code).toBe(
        'TIME_ENTRY_NOT_EDITABLE',
      );
    });

    it('rejects approving an already-approved entry (invalid transition)', async () => {
      const entry = await createApprovedEntry();
      const res = await request(server)
        .post(`/api/v1/time-entries/${entry.id}/approve`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(res.body).code).toBe('TIME_ENTRY_INVALID_TRANSITION');
    });

    it('voids an unbilled entry and an approved entry', async () => {
      const createRes = await createEntryReq().expect(201);
      const unbilledId = asSuccess<TimeEntryPayload>(createRes.body).id;
      const voidUnbilledRes = await request(server)
        .post(`/api/v1/time-entries/${unbilledId}/void`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      expect(asSuccess<TimeEntryPayload>(voidUnbilledRes.body).status).toBe(
        'voided',
      );

      const approved = await createApprovedEntry();
      const voidApprovedRes = await request(server)
        .post(`/api/v1/time-entries/${approved.id}/void`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      expect(asSuccess<TimeEntryPayload>(voidApprovedRes.body).status).toBe(
        'voided',
      );
    });

    it('deletes a non-invoiced entry, and 404s reading it afterward', async () => {
      const createRes = await createEntryReq().expect(201);
      const entryId = asSuccess<TimeEntryPayload>(createRes.body).id;

      await request(server)
        .delete(`/api/v1/time-entries/${entryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);

      const getRes = await request(server)
        .get(`/api/v1/time-entries/${entryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(404);
      expect(asError(getRes.body).code).toBe('TIME_ENTRY_NOT_FOUND');
    });

    describe('generate-invoice', () => {
      it('bills approved entries into one invoice with correct totals, and flips them to "invoiced"', async () => {
        const entryA = await createApprovedEntry({
          description: 'Session A',
          durationMinutes: 60,
          hourlyRate: 100,
        });
        const entryB = await createApprovedEntry({
          description: 'Session B',
          durationMinutes: 30,
          hourlyRate: 100,
        });

        const res = await request(server)
          .post('/api/v1/time-entries/generate-invoice')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .send({ timeEntryIds: [entryA.id, entryB.id] })
          .expect(201);
        const invoice = asSuccess<InvoicePayload>(res.body);
        expect(invoice.items).toHaveLength(2);
        // 1h @ 100 + 0.5h @ 100 = 150
        expect(invoice.subtotal).toBe(150);
        expect(invoice.total).toBe(150);

        const entryAAfter = await request(server)
          .get(`/api/v1/time-entries/${entryA.id}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .expect(200);
        const payloadA = asSuccess<TimeEntryPayload>(entryAAfter.body);
        expect(payloadA.status).toBe('invoiced');
        expect(payloadA.invoiceId).toBe(invoice.id);
      });

      it('rejects a batch containing a non-approved entry', async () => {
        const approved = await createApprovedEntry();
        const unbilledRes = await createEntryReq().expect(201);
        const unbilled = asSuccess<TimeEntryPayload>(unbilledRes.body);

        const res = await request(server)
          .post('/api/v1/time-entries/generate-invoice')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .send({ timeEntryIds: [approved.id, unbilled.id] })
          .expect(400);
        expect(asError(res.body).code).toBe('TIME_ENTRY_NOT_APPROVED');
      });

      it('rejects a batch containing a non-billable entry', async () => {
        const billable = await createApprovedEntry();
        const nonBillable = await createApprovedEntry({
          billable: false,
          hourlyRate: undefined,
        });

        const res = await request(server)
          .post('/api/v1/time-entries/generate-invoice')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .send({ timeEntryIds: [billable.id, nonBillable.id] })
          .expect(400);
        expect(asError(res.body).code).toBe('TIME_ENTRY_NOT_BILLABLE');
      });

      it('rejects a batch spanning more than one contact', async () => {
        const otherContactRes = await request(server)
          .post('/api/v1/contacts')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .send({ firstName: 'Other', lastName: 'Client' })
          .expect(201);
        const otherContactId = asSuccess<ContactPayload>(
          otherContactRes.body,
        ).id;

        const entryA = await createApprovedEntry({ contactId });
        const entryB = await createApprovedEntry({
          contactId: otherContactId,
        });

        const res = await request(server)
          .post('/api/v1/time-entries/generate-invoice')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .send({ timeEntryIds: [entryA.id, entryB.id] })
          .expect(400);
        expect(asError(res.body).code).toBe('TIME_ENTRIES_MIXED_CONTACT');
      });

      it('rejects a batch spanning more than one currency', async () => {
        const entryA = await createApprovedEntry({ currency: 'EUR' });
        const entryB = await createApprovedEntry({ currency: 'USD' });

        const res = await request(server)
          .post('/api/v1/time-entries/generate-invoice')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .send({ timeEntryIds: [entryA.id, entryB.id] })
          .expect(400);
        expect(asError(res.body).code).toBe('TIME_ENTRIES_MIXED_CURRENCY');
      });

      it('404s a batch referencing an unknown time entry id', async () => {
        const entryA = await createApprovedEntry();
        const res = await request(server)
          .post('/api/v1/time-entries/generate-invoice')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .send({
            timeEntryIds: [entryA.id, '000000000000000000000000'],
          })
          .expect(404);
        expect(asError(res.body).code).toBe('TIME_ENTRY_NOT_FOUND');
      });

      it('deleting an invoiced entry is rejected (TIME_ENTRY_ALREADY_INVOICED)', async () => {
        const entry = await createApprovedEntry();
        await request(server)
          .post('/api/v1/time-entries/generate-invoice')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .send({ timeEntryIds: [entry.id] })
          .expect(201);

        const res = await request(server)
          .delete(`/api/v1/time-entries/${entry.id}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .expect(400);
        expect(asError(res.body).code).toBe('TIME_ENTRY_ALREADY_INVOICED');
      });

      it('two concurrent generate-invoice calls sharing the same entries: exactly one Invoice is created, the loser gets TIME_ENTRIES_NOT_INVOICEABLE', async () => {
        const entryA = await createApprovedEntry();
        const entryB = await createApprovedEntry();

        const [resA, resB] = await Promise.all([
          request(server)
            .post('/api/v1/time-entries/generate-invoice')
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Organization-Id', organizationId)
            .send({ timeEntryIds: [entryA.id, entryB.id] }),
          request(server)
            .post('/api/v1/time-entries/generate-invoice')
            .set('Authorization', `Bearer ${accessToken}`)
            .set('X-Organization-Id', organizationId)
            .send({ timeEntryIds: [entryA.id, entryB.id] }),
        ]);

        const results = [resA, resB];
        const succeeded = results.filter((r) => r.status === 201);
        const rejected = results.filter((r) => r.status === 400);
        expect(succeeded).toHaveLength(1);
        expect(rejected).toHaveLength(1);
        expect(asError(rejected[0]!.body).code).toBe(
          'TIME_ENTRIES_NOT_INVOICEABLE',
        );

        const winningInvoice = asSuccess<InvoicePayload>(succeeded[0]!.body);

        const entryAAfter = await request(server)
          .get(`/api/v1/time-entries/${entryA.id}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .expect(200);
        const payloadA = asSuccess<TimeEntryPayload>(entryAAfter.body);
        expect(payloadA.status).toBe('invoiced');
        expect(payloadA.invoiceId).toBe(winningInvoice.id);
      });
    });

    it('denies a user from another organization reading time entries via a foreign org id', async () => {
      const a = await registerOrgAndContact(
        'time-entries-iso-a@korva.test',
        'Time Entries Iso A',
      );
      const b = await registerOrgAndContact(
        'time-entries-iso-b@korva.test',
        'Time Entries Iso B',
      );

      await request(server)
        .post('/api/v1/time-entries')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .send({
          contactId: a.contactId,
          date: new Date().toISOString(),
          durationMinutes: 60,
          description: 'Secret entry',
          billable: true,
          hourlyRate: 100,
          currency: 'EUR',
        })
        .expect(201);

      const res = await request(server)
        .get('/api/v1/time-entries')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .expect(403);
      expect(asError(res.body).code).toBe('ORGANIZATION_ACCESS_DENIED');
    });

    it('STAFF can create/read/update their own entries but is denied approve/generate-invoice/delete', async () => {
      const owner = await registerOrgAndContact(
        'time-entries-rbac-staff-owner@korva.test',
        'Time Entries RBAC Staff Org',
      );
      const staffAuthRes = await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: 'time-entries-rbac-staff@korva.test',
          password: 'password123',
        })
        .expect(201);
      const staffToken = asSuccess<AuthPayload>(staffAuthRes.body).accessToken;

      const staffRole = await connection.collection('roles').findOne({
        organizationId: new Types.ObjectId(owner.organizationId),
        systemKey: 'STAFF',
      });
      expect(staffRole).not.toBeNull();

      await request(server)
        .post('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .send({
          email: 'time-entries-rbac-staff@korva.test',
          roleId: String(staffRole?._id),
        })
        .expect(201);

      const createRes = await request(server)
        .post('/api/v1/time-entries')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .send({
          contactId: owner.contactId,
          date: new Date().toISOString(),
          durationMinutes: 60,
          description: 'Staff-logged work',
          billable: true,
          hourlyRate: 80,
          currency: 'EUR',
        })
        .expect(201);
      const entryId = asSuccess<TimeEntryPayload>(createRes.body).id;

      await request(server)
        .patch(`/api/v1/time-entries/${entryId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .send({ description: 'Updated by staff' })
        .expect(200);

      const approveAsStaffRes = await request(server)
        .post(`/api/v1/time-entries/${entryId}/approve`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .expect(403);
      expect(asError(approveAsStaffRes.body).code).toBe('PERMISSION_DENIED');

      const deleteAsStaffRes = await request(server)
        .delete(`/api/v1/time-entries/${entryId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .expect(403);
      expect(asError(deleteAsStaffRes.body).code).toBe('PERMISSION_DENIED');

      const generateAsStaffRes = await request(server)
        .post('/api/v1/time-entries/generate-invoice')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .send({ timeEntryIds: [entryId] })
        .expect(403);
      expect(asError(generateAsStaffRes.body).code).toBe('PERMISSION_DENIED');
    });

    it('FINANCE can approve and generate an invoice but is denied creating a time entry', async () => {
      const owner = await registerOrgAndContact(
        'time-entries-rbac-finance-owner@korva.test',
        'Time Entries RBAC Finance Org',
      );
      const financeAuthRes = await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: 'time-entries-rbac-finance@korva.test',
          password: 'password123',
        })
        .expect(201);
      const financeToken = asSuccess<AuthPayload>(
        financeAuthRes.body,
      ).accessToken;

      const financeRole = await connection.collection('roles').findOne({
        organizationId: new Types.ObjectId(owner.organizationId),
        systemKey: 'FINANCE',
      });
      expect(financeRole).not.toBeNull();

      await request(server)
        .post('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .send({
          email: 'time-entries-rbac-finance@korva.test',
          roleId: String(financeRole?._id),
        })
        .expect(201);

      const createAsFinanceRes = await request(server)
        .post('/api/v1/time-entries')
        .set('Authorization', `Bearer ${financeToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .send({
          contactId: owner.contactId,
          date: new Date().toISOString(),
          durationMinutes: 60,
          description: 'Should be denied',
          billable: true,
          hourlyRate: 80,
          currency: 'EUR',
        })
        .expect(403);
      expect(asError(createAsFinanceRes.body).code).toBe('PERMISSION_DENIED');

      const ownerCreateRes = await request(server)
        .post('/api/v1/time-entries')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .send({
          contactId: owner.contactId,
          date: new Date().toISOString(),
          durationMinutes: 60,
          description: 'Owner-created',
          billable: true,
          hourlyRate: 80,
          currency: 'EUR',
        })
        .expect(201);
      const entryId = asSuccess<TimeEntryPayload>(ownerCreateRes.body).id;

      await request(server)
        .post(`/api/v1/time-entries/${entryId}/approve`)
        .set('Authorization', `Bearer ${financeToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .expect(201);

      await request(server)
        .post('/api/v1/time-entries/generate-invoice')
        .set('Authorization', `Bearer ${financeToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .send({ timeEntryIds: [entryId] })
        .expect(201);
    });
  });
});
