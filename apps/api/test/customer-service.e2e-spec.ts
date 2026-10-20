import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { putOrganizationOnPlan } from './support/plan-tier';

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
interface CustomerAuthPayload {
  accessToken: string;
}
interface OrganizationPayload {
  id: string;
  slug: string;
}
interface ContactPayload {
  id: string;
}
interface MembershipPayload {
  id: string;
}
interface TicketPayload {
  id: string;
  status: string;
  priority: string;
  assigneeMembershipId?: string;
  contactId: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

describe('Customer Service module (e2e)', () => {
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

  async function registerOrgAndToken(email: string, orgName: string) {
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
        type: 'services',
        country: 'FR',
        currency: 'EUR',
        timezone: 'Europe/Paris',
        language: 'fr',
      })
      .expect(201);
    const organization = asSuccess<OrganizationPayload>(orgRes.body);
    // Paid-plan features are scaffolding here, not what is tested (PLAN_FEATURE_MIN_PLAN).
    await putOrganizationOnPlan(connection, organization.id, 'business');

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ enabledModules: ['crm', 'communication'] })
      .expect(200);

    return {
      accessToken,
      organizationId: organization.id,
      slug: organization.slug,
    };
  }

  async function createContact(
    accessToken: string,
    organizationId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<string> {
    const res = await request(server)
      .post('/api/v1/contacts')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organizationId)
      .send({ firstName: 'Client', ...overrides })
      .expect(201);
    return asSuccess<ContactPayload>(res.body).id;
  }

  describe('ticket lifecycle', () => {
    let accessToken: string;
    let organizationId: string;
    let contactId: string;
    let membershipId: string;

    beforeAll(async () => {
      ({ accessToken, organizationId } = await registerOrgAndToken(
        'ticket-lifecycle@korva.test',
        'Ticket Lifecycle Org',
      ));
      contactId = await createContact(accessToken, organizationId, {
        email: 'ticket-contact@customer.test',
      });

      const meRes = await request(server)
        .get('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      membershipId = asSuccess<MembershipPayload[]>(meRes.body)[0]!.id;
    });

    it('creates, gets, lists, and updates a ticket', async () => {
      const createRes = await request(server)
        .post('/api/v1/tickets')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ subject: 'Cannot log in', contactId, priority: 'high' })
        .expect(201);
      const ticket = asSuccess<TicketPayload>(createRes.body);
      expect(ticket.status).toBe('open');
      expect(ticket.priority).toBe('high');

      await request(server)
        .get(`/api/v1/tickets/${ticket.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);

      const listRes = await request(server)
        .get('/api/v1/tickets')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(
        asSuccess<TicketPayload[]>(listRes.body).some(
          (t) => t.id === ticket.id,
        ),
      ).toBe(true);

      const updateRes = await request(server)
        .patch(`/api/v1/tickets/${ticket.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ priority: 'urgent' })
        .expect(200);
      expect(asSuccess<TicketPayload>(updateRes.body).priority).toBe('urgent');
    });

    it('rejects creating a ticket for a nonexistent contact', async () => {
      const res = await request(server)
        .post('/api/v1/tickets')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ subject: 'x', contactId: new Types.ObjectId().toString() })
        .expect(404);
      expect(asError(res.body).code).toBe('CONTACT_NOT_FOUND');
    });

    it('assigns a ticket to a valid membership and rejects an unknown one', async () => {
      const createRes = await request(server)
        .post('/api/v1/tickets')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ subject: 'Assign me', contactId })
        .expect(201);
      const ticketId = asSuccess<TicketPayload>(createRes.body).id;

      const assignRes = await request(server)
        .post(`/api/v1/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ assigneeMembershipId: membershipId })
        .expect(201);
      expect(
        asSuccess<TicketPayload>(assignRes.body).assigneeMembershipId,
      ).toBe(membershipId);

      const badRes = await request(server)
        .post(`/api/v1/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ assigneeMembershipId: new Types.ObjectId().toString() })
        .expect(404);
      expect(asError(badRes.body).code).toBe('MEMBERSHIP_NOT_FOUND');
    });

    it('walks the full resolve/close/reopen state machine with its guards', async () => {
      const createRes = await request(server)
        .post('/api/v1/tickets')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ subject: 'Lifecycle', contactId })
        .expect(201);
      const ticketId = asSuccess<TicketPayload>(createRes.body).id;

      // resolve
      const resolveRes = await request(server)
        .post(`/api/v1/tickets/${ticketId}/resolve`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      expect(asSuccess<TicketPayload>(resolveRes.body).status).toBe('resolved');

      const doubleResolve = await request(server)
        .post(`/api/v1/tickets/${ticketId}/resolve`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(doubleResolve.body).code).toBe('TICKET_ALREADY_RESOLVED');

      // close
      const closeRes = await request(server)
        .post(`/api/v1/tickets/${ticketId}/close`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      expect(asSuccess<TicketPayload>(closeRes.body).status).toBe('closed');

      const doubleClose = await request(server)
        .post(`/api/v1/tickets/${ticketId}/close`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(doubleClose.body).code).toBe('TICKET_ALREADY_CLOSED');

      const resolveWhileClosed = await request(server)
        .post(`/api/v1/tickets/${ticketId}/resolve`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(resolveWhileClosed.body).code).toBe(
        'TICKET_NOT_RESOLVABLE',
      );

      // reopen
      const reopenRes = await request(server)
        .post(`/api/v1/tickets/${ticketId}/reopen`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
      expect(asSuccess<TicketPayload>(reopenRes.body).status).toBe('open');

      const reopenWhileOpen = await request(server)
        .post(`/api/v1/tickets/${ticketId}/reopen`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(reopenWhileOpen.body).code).toBe('TICKET_NOT_CLOSED');

      // resolve again works after reopen (resolvedAt/closedAt were actually cleared, not
      // just left stale — this is the $unset-vs-implicit-$set correctness check).
      await request(server)
        .post(`/api/v1/tickets/${ticketId}/resolve`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(201);
    });
  });

  describe('RBAC', () => {
    let ownerToken: string;
    let organizationId: string;
    let contactId: string;

    async function addMember(
      email: string,
      systemKey: string,
    ): Promise<string> {
      const authRes = await request(server)
        .post('/api/v1/auth/register')
        .send({ email, password: 'password123' })
        .expect(201);
      const accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

      const role = await connection.collection('roles').findOne({
        organizationId: new Types.ObjectId(organizationId),
        systemKey,
      });
      expect(role).not.toBeNull();

      await request(server)
        .post('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ email, roleId: String(role?._id) })
        .expect(201);

      return accessToken;
    }

    beforeAll(async () => {
      ({ accessToken: ownerToken, organizationId } = await registerOrgAndToken(
        'ticket-rbac@korva.test',
        'Ticket RBAC Org',
      ));
      // Free plan caps seats at 3 — this describe block adds 4 more members (STAFF, MANAGER,
      // SALES, FINANCE) on top of the owner, so it needs a plan without that ceiling.
      await request(server)
        .post('/api/v1/subscriptions/change-plan')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ planKey: 'business' })
        .expect(201);
      contactId = await createContact(ownerToken, organizationId, {
        email: 'rbac-contact@customer.test',
      });
    });

    it('lets STAFF read/create/update tickets but not assign them', async () => {
      const staffToken = await addMember(
        'ticket-rbac-staff@korva.test',
        'STAFF',
      );

      const createRes = await request(server)
        .post('/api/v1/tickets')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ subject: 'Staff-created', contactId })
        .expect(201);
      const ticketId = asSuccess<TicketPayload>(createRes.body).id;

      await request(server)
        .patch(`/api/v1/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ priority: 'low' })
        .expect(200);

      const assignRes = await request(server)
        .post(`/api/v1/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ assigneeMembershipId: new Types.ObjectId().toString() })
        .expect(403);
      expect(asError(assignRes.body).code).toBe('PERMISSION_DENIED');
    });

    it('lets MANAGER assign tickets', async () => {
      const managerToken = await addMember(
        'ticket-rbac-manager@korva.test',
        'MANAGER',
      );

      const createRes = await request(server)
        .post('/api/v1/tickets')
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ subject: 'Manager-created', contactId })
        .expect(201);
      const ticketId = asSuccess<TicketPayload>(createRes.body).id;

      const meRes = await request(server)
        .get('/api/v1/organizations/me/members')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const ownerMembershipId = asSuccess<MembershipPayload[]>(meRes.body)[0]!
        .id;

      await request(server)
        .post(`/api/v1/tickets/${ticketId}/assign`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ assigneeMembershipId: ownerMembershipId })
        .expect(201);
    });

    it('denies SALES and FINANCE any access to tickets', async () => {
      const salesToken = await addMember(
        'ticket-rbac-sales@korva.test',
        'SALES',
      );
      const financeToken = await addMember(
        'ticket-rbac-finance@korva.test',
        'FINANCE',
      );

      for (const token of [salesToken, financeToken]) {
        const res = await request(server)
          .get('/api/v1/tickets')
          .set('Authorization', `Bearer ${token}`)
          .set('X-Organization-Id', organizationId)
          .expect(403);
        expect(asError(res.body).code).toBe('PERMISSION_DENIED');
      }
    });
  });

  describe('customer portal', () => {
    let accessToken: string;
    let organizationId: string;
    let slug: string;
    let customerToken: string;
    let otherCustomerToken: string;

    beforeAll(async () => {
      ({ accessToken, organizationId, slug } = await registerOrgAndToken(
        'ticket-portal@korva.test',
        'Ticket Portal Org',
      ));

      await createContact(accessToken, organizationId, {
        email: 'portal-customer@customer.test',
      });

      const custRes = await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({
          email: 'portal-customer@customer.test',
          password: 'clientpass123',
        })
        .expect(201);
      customerToken = asSuccess<CustomerAuthPayload>(custRes.body).accessToken;

      const otherRes = await request(server)
        .post(`/api/v1/public/${slug}/account/register`)
        .send({
          email: 'other-portal-customer@customer.test',
          password: 'clientpass123',
        })
        .expect(201);
      otherCustomerToken = asSuccess<CustomerAuthPayload>(
        otherRes.body,
      ).accessToken;
    });

    it('lets a customer create, list, and get their own ticket without supplying a contactId', async () => {
      const createRes = await request(server)
        .post(`/api/v1/public/${slug}/account/tickets`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ subject: 'I need help with my order' })
        .expect(201);
      const ticket = asSuccess<TicketPayload>(createRes.body);
      expect(ticket.status).toBe('open');

      const listRes = await request(server)
        .get(`/api/v1/public/${slug}/account/tickets`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
      expect(
        asSuccess<TicketPayload[]>(listRes.body).some(
          (t) => t.id === ticket.id,
        ),
      ).toBe(true);

      await request(server)
        .get(`/api/v1/public/${slug}/account/tickets/${ticket.id}`)
        .set('Authorization', `Bearer ${customerToken}`)
        .expect(200);
    });

    it("never lets a customer read another customer's ticket", async () => {
      const createRes = await request(server)
        .post(`/api/v1/public/${slug}/account/tickets`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ subject: 'Private ticket' })
        .expect(201);
      const ticketId = asSuccess<TicketPayload>(createRes.body).id;

      const res = await request(server)
        .get(`/api/v1/public/${slug}/account/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${otherCustomerToken}`)
        .expect(404);
      expect(asError(res.body).code).toBe('TICKET_NOT_FOUND');
    });

    it('staff can see a ticket a customer created through the portal', async () => {
      const createRes = await request(server)
        .post(`/api/v1/public/${slug}/account/tickets`)
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ subject: 'Visible to staff too' })
        .expect(201);
      const ticketId = asSuccess<TicketPayload>(createRes.body).id;

      await request(server)
        .get(`/api/v1/tickets/${ticketId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
    });
  });
});
