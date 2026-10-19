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
interface OrganizationPayload {
  id: string;
}
interface OfferVariantPayload {
  id: string;
  name: string;
}
interface OfferPayload {
  id: string;
  type: string;
  status: string;
  variants: OfferVariantPayload[];
  customFields: Record<string, unknown>;
  barcode?: string;
  attributes?: Record<string, string>;
  isBundle?: boolean;
  bundleItems?: { offerId: string; quantity: number }[];
}
interface ContactPayload {
  id: string;
}
interface ResourcePayload {
  id: string;
}
interface WorkflowPayload {
  id: string;
}
interface WorkflowExecutionPayload {
  status: string;
  eventName: string;
  payload: Record<string, unknown>;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

async function waitFor<T>(
  check: () => Promise<T | undefined>,
  timeoutMs = 15000,
  intervalMs = 300,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result !== undefined) return result;
    if (Date.now() > deadline) {
      throw new Error('waitFor: timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe('Catalog module (e2e)', () => {
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
        type: 'commerce',
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
      .send({ enabledModules: ['catalog'] })
      .expect(200);

    // Paid tier, for two reasons this spec does not itself test: it adds STAFF members (the
    // free plan is one seat, the owner's) and registerOrgWithModules below enables `finance`
    // to reach quotes and invoices. Both gates are covered by subscriptions.e2e-spec.ts.
    await putOrganizationOnPlan(connection, organizationId);

    return { accessToken, organizationId };
  }

  describe('offers CRUD, variants and custom fields', () => {
    let accessToken: string;
    let organizationId: string;
    let offerId: string;

    beforeAll(async () => {
      ({ accessToken, organizationId } = await registerOrgAndToken(
        'catalog-owner@korva.test',
        'Catalog Org',
      ));
      await request(server)
        .post('/api/v1/custom-fields')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          entity: 'offers',
          key: 'material',
          label: 'Material',
          type: 'text',
        })
        .expect(201);
    });

    it('rejects an offer with an unknown custom field', async () => {
      const res = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Bad',
          pricing: { amount: 1, currency: 'EUR' },
          customFields: { nope: 1 },
        })
        .expect(400);
      expect(asError(res.body).code).toBe('UNKNOWN_CUSTOM_FIELD');
    });

    it('creates a product offer with variants and a custom field, assigning ids to each variant', async () => {
      const res = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'T-Shirt',
          categories: ['clothing'],
          pricing: { amount: 19.99, currency: 'EUR', taxRate: 20 },
          sku: 'TSHIRT-01',
          status: 'active',
          variants: [{ name: 'S' }, { name: 'M' }],
          customFields: { material: 'cotton' },
        })
        .expect(201);
      const offer = asSuccess<OfferPayload>(res.body);
      offerId = offer.id;
      expect(offer.variants).toHaveLength(2);
      expect(offer.variants[0]?.id).toBeTruthy();
      expect(offer.customFields.material).toBe('cotton');
    });

    it('creates a bundle offer referencing another offer, and stores a barcode + free-form attributes (Phase C1)', async () => {
      const componentRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Component Widget',
          pricing: { amount: 5, currency: 'EUR' },
          barcode: '1234567890123',
          attributes: { couleur: 'rouge', taille: 'M' },
        })
        .expect(201);
      const component = asSuccess<OfferPayload>(componentRes.body);
      expect(component.barcode).toBe('1234567890123');
      expect(component.attributes).toEqual({ couleur: 'rouge', taille: 'M' });

      const bundleRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Bundle Pack',
          pricing: { amount: 9, currency: 'EUR' },
          isBundle: true,
          bundleItems: [{ offerId: component.id, quantity: 2 }],
        })
        .expect(201);
      const bundle = asSuccess<OfferPayload>(bundleRes.body);
      expect(bundle.isBundle).toBe(true);
      expect(bundle.bundleItems).toEqual([
        { offerId: component.id, quantity: 2 },
      ]);
    });

    it('filters offers by type', async () => {
      await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'service',
          name: 'Consulting',
          pricing: { amount: 50, currency: 'EUR' },
        })
        .expect(201);

      const res = await request(server)
        .get('/api/v1/offers?type=service')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const offers = asSuccess<OfferPayload[]>(res.body);
      expect(offers.every((o) => o.type === 'service')).toBe(true);
    });

    it('finds the offer by full-text search on its name', async () => {
      const res = await request(server)
        .get('/api/v1/offers?search=T-Shirt')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const offers = asSuccess<OfferPayload[]>(res.body);
      expect(offers.map((o) => o.id)).toContain(offerId);
    });

    it('updates the offer status and then deletes it', async () => {
      const updateRes = await request(server)
        .patch(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ status: 'archived' })
        .expect(200);
      expect(asSuccess<OfferPayload>(updateRes.body).status).toBe('archived');

      await request(server)
        .delete(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);

      await request(server)
        .get(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(404);
    });

    it('publishes offer.created, verified by a Workflow configured on it actually firing', async () => {
      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ enabledModules: ['catalog', 'workflow'] })
        .expect(200);

      const workflowRes = await request(server)
        .post('/api/v1/workflows')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'On offer created',
          trigger: 'offer.created',
          conditions: [],
          actions: [
            {
              type: 'create_task',
              config: { title: 'Review new offer {{offerId}}' },
            },
          ],
        })
        .expect(201);
      const workflowId = asSuccess<WorkflowPayload>(workflowRes.body).id;

      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Event-coverage probe offer',
          pricing: { amount: 5, currency: 'EUR' },
        })
        .expect(201);
      const newOfferId = asSuccess<OfferPayload>(offerRes.body).id;

      const executions = await waitFor(async () => {
        const res = await request(server)
          .get(`/api/v1/workflows/${workflowId}/executions`)
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .expect(200);
        const data = asSuccess<WorkflowExecutionPayload[]>(res.body);
        return data.length > 0 ? data : undefined;
      });

      expect(executions).toHaveLength(1);
      expect(executions[0]!.status).toBe('success');
      expect(executions[0]!.eventName).toBe('offer.created');
      expect(executions[0]!.payload.offerId).toBe(newOfferId);
    }, 20000);
  });

  describe('tenant isolation for offers', () => {
    it('denies a user from another organization reading offers via a foreign org id', async () => {
      const a = await registerOrgAndToken(
        'catalog-iso-a@korva.test',
        'Catalog Iso A',
      );
      const b = await registerOrgAndToken(
        'catalog-iso-b@korva.test',
        'Catalog Iso B',
      );

      await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .send({
          type: 'product',
          name: 'Secret Product',
          pricing: { amount: 1, currency: 'EUR' },
        })
        .expect(201);

      const res = await request(server)
        .get('/api/v1/offers')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .expect(403);
      expect(asError(res.body).code).toBe('ORGANIZATION_ACCESS_DENIED');

      const ownRes = await request(server)
        .get('/api/v1/offers')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', b.organizationId)
        .expect(200);
      expect(asSuccess<OfferPayload[]>(ownRes.body)).toHaveLength(0);
    });
  });

  describe('offer deletion protection (LOT G1)', () => {
    async function registerOrgWithModules(
      email: string,
      orgName: string,
      enabledModules: string[],
    ) {
      const org = await registerOrgAndToken(email, orgName);
      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${org.accessToken}`)
        .set('X-Organization-Id', org.organizationId)
        .send({ enabledModules })
        .expect(200);
      return org;
    }

    async function createOffer(
      accessToken: string,
      organizationId: string,
      name: string,
    ): Promise<string> {
      const res = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name,
          pricing: { amount: 10, currency: 'EUR' },
        })
        .expect(201);
      return asSuccess<OfferPayload>(res.body).id;
    }

    async function createContact(
      accessToken: string,
      organizationId: string,
      firstName: string,
    ): Promise<string> {
      const res = await request(server)
        .post('/api/v1/contacts')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ firstName })
        .expect(201);
      return asSuccess<ContactPayload>(res.body).id;
    }

    async function createResource(
      accessToken: string,
      organizationId: string,
      name: string,
    ): Promise<string> {
      const res = await request(server)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ name, type: 'room' })
        .expect(201);
      return asSuccess<ResourcePayload>(res.body).id;
    }

    it('deletes an offer referenced by nothing (unchanged behavior)', async () => {
      const { accessToken, organizationId } = await registerOrgWithModules(
        'g1-unused@korva.test',
        'G1 Unused Org',
        ['catalog'],
      );
      const offerId = await createOffer(accessToken, organizationId, 'Unused');

      await request(server)
        .delete(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);

      await request(server)
        .get(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(404);
    });

    it('blocks deletion of an offer referenced by an order line item, and leaves it intact', async () => {
      const { accessToken, organizationId } = await registerOrgWithModules(
        'g1-order@korva.test',
        'G1 Order Org',
        ['catalog', 'crm', 'commerce'],
      );
      const offerId = await createOffer(accessToken, organizationId, 'Sofa');
      const contactId = await createContact(
        accessToken,
        organizationId,
        'Buyer',
      );

      await request(server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          items: [{ offerId, description: 'Sofa', quantity: 1, unitPrice: 10 }],
          currency: 'EUR',
        })
        .expect(201);

      const res = await request(server)
        .delete(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(409);
      expect(asError(res.body).code).toBe('OFFER_IN_USE');

      await request(server)
        .get(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
    });

    it('blocks deletion of an offer referenced by a quote line item, and leaves it intact', async () => {
      const { accessToken, organizationId } = await registerOrgWithModules(
        'g1-quote@korva.test',
        'G1 Quote Org',
        ['catalog', 'crm', 'finance'],
      );
      const offerId = await createOffer(accessToken, organizationId, 'Chair');
      const contactId = await createContact(
        accessToken,
        organizationId,
        'Prospect',
      );

      await request(server)
        .post('/api/v1/quotes')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          items: [
            { offerId, description: 'Chair', quantity: 1, unitPrice: 10 },
          ],
          currency: 'EUR',
        })
        .expect(201);

      const res = await request(server)
        .delete(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(409);
      expect(asError(res.body).code).toBe('OFFER_IN_USE');

      await request(server)
        .get(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
    });

    it('blocks deletion of an offer referenced by an invoice line item, and leaves it intact', async () => {
      const { accessToken, organizationId } = await registerOrgWithModules(
        'g1-invoice@korva.test',
        'G1 Invoice Org',
        ['catalog', 'crm', 'finance'],
      );
      const offerId = await createOffer(accessToken, organizationId, 'Lamp');
      const contactId = await createContact(
        accessToken,
        organizationId,
        'Client',
      );

      await request(server)
        .post('/api/v1/invoices')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          contactId,
          items: [{ offerId, description: 'Lamp', quantity: 1, unitPrice: 10 }],
          currency: 'EUR',
        })
        .expect(201);

      const res = await request(server)
        .delete(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(409);
      expect(asError(res.body).code).toBe('OFFER_IN_USE');

      await request(server)
        .get(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
    });

    it('blocks deletion of an offer referenced by a booking, and leaves it intact', async () => {
      const { accessToken, organizationId } = await registerOrgWithModules(
        'g1-booking@korva.test',
        'G1 Booking Org',
        ['catalog', 'crm', 'booking'],
      );
      const offerId = await createOffer(accessToken, organizationId, 'Séance');
      const contactId = await createContact(
        accessToken,
        organizationId,
        'Client',
      );
      const resourceId = await createResource(
        accessToken,
        organizationId,
        'Salle 1',
      );

      await request(server)
        .post('/api/v1/bookings')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          resourceId,
          offerId,
          contactId,
          startAt: new Date(Date.now() + 3600_000).toISOString(),
          endAt: new Date(Date.now() + 7200_000).toISOString(),
        })
        .expect(201);

      const res = await request(server)
        .delete(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(409);
      expect(asError(res.body).code).toBe('OFFER_IN_USE');

      await request(server)
        .get(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
    });

    // Not one of the entities named in the original finding (Order/Quote/Invoice/Booking) —
    // found during this lot's own exhaustive reference search: CartItem.offerId is a required
    // field, and Cart has no soft-delete/expiry, so an item sitting in an open (or abandoned)
    // cart is just as permanent a reference as a placed order.
    it('blocks deletion of an offer referenced by a cart item, and leaves it intact', async () => {
      const { accessToken, organizationId } = await registerOrgWithModules(
        'g1-cart@korva.test',
        'G1 Cart Org',
        ['catalog', 'crm', 'commerce'],
      );
      const offerId = await createOffer(accessToken, organizationId, 'Mug');
      const contactId = await createContact(
        accessToken,
        organizationId,
        'Shopper',
      );

      const cartRes = await request(server)
        .get(`/api/v1/carts?contactId=${contactId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const cartId = asSuccess<{ id: string }>(cartRes.body).id;

      await request(server)
        .post(`/api/v1/carts/${cartId}/items`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ offerId, quantity: 1 })
        .expect(201);

      const res = await request(server)
        .delete(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(409);
      expect(asError(res.body).code).toBe('OFFER_IN_USE');

      await request(server)
        .get(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
    });

    it('never lets a reference from a different organization block deletion', async () => {
      const orgA = await registerOrgWithModules(
        'g1-tenant-a@korva.test',
        'G1 Tenant A',
        ['catalog'],
      );
      const orgB = await registerOrgWithModules(
        'g1-tenant-b@korva.test',
        'G1 Tenant B',
        ['catalog', 'crm', 'commerce'],
      );
      const offerAId = await createOffer(
        orgA.accessToken,
        orgA.organizationId,
        'Org A Offer',
      );
      const contactBId = await createContact(
        orgB.accessToken,
        orgB.organizationId,
        'Org B Contact',
      );

      // Real, API-created reference in a different organization to the same offerId — orders
      // do not validate that a line item's offerId belongs to the caller's own organization
      // (see OrdersService.create), so this proves hasAnyReference's Mongo filter is genuinely
      // scoped by organizationId and not just by offerId matching.
      await request(server)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${orgB.accessToken}`)
        .set('X-Organization-Id', orgB.organizationId)
        .send({
          contactId: contactBId,
          items: [
            {
              offerId: offerAId,
              description: 'Cross-tenant reference',
              quantity: 1,
              unitPrice: 10,
            },
          ],
          currency: 'EUR',
        })
        .expect(201);

      await request(server)
        .delete(`/api/v1/offers/${offerAId}`)
        .set('Authorization', `Bearer ${orgA.accessToken}`)
        .set('X-Organization-Id', orgA.organizationId)
        .expect(200);
    });

    it('returns 404 for an offer that does not exist', async () => {
      const { accessToken, organizationId } = await registerOrgWithModules(
        'g1-missing@korva.test',
        'G1 Missing Org',
        ['catalog'],
      );

      const res = await request(server)
        .delete('/api/v1/offers/000000000000000000000000')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(404);
      expect(asError(res.body).code).toBe('OFFER_NOT_FOUND');
    });

    it("returns 404 (not a false OFFER_IN_USE) when deleting another tenant's offer", async () => {
      const orgA = await registerOrgWithModules(
        'g1-cross-a@korva.test',
        'G1 Cross A',
        ['catalog'],
      );
      const orgB = await registerOrgWithModules(
        'g1-cross-b@korva.test',
        'G1 Cross B',
        ['catalog'],
      );
      const offerBId = await createOffer(
        orgB.accessToken,
        orgB.organizationId,
        'Belongs To B',
      );

      const res = await request(server)
        .delete(`/api/v1/offers/${offerBId}`)
        .set('Authorization', `Bearer ${orgA.accessToken}`)
        .set('X-Organization-Id', orgA.organizationId)
        .expect(404);
      expect(asError(res.body).code).toBe('OFFER_NOT_FOUND');
    });

    it('denies a STAFF member (no offers.delete) from deleting an offer', async () => {
      const owner = await registerOrgWithModules(
        'g1-rbac-owner@korva.test',
        'G1 RBAC Org',
        ['catalog'],
      );
      const staffAuthRes = await request(server)
        .post('/api/v1/auth/register')
        .send({ email: 'g1-rbac-staff@korva.test', password: 'password123' })
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
          email: 'g1-rbac-staff@korva.test',
          roleId: String(staffRole?._id),
        })
        .expect(201);

      const offerId = await createOffer(
        owner.accessToken,
        owner.organizationId,
        'Protected',
      );

      const res = await request(server)
        .delete(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .expect(403);
      expect(asError(res.body).code).toBe('PERMISSION_DENIED');

      await request(server)
        .get(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set('X-Organization-Id', owner.organizationId)
        .expect(200);
    });
  });

  describe('categories CRUD, delete-protection and tenant isolation', () => {
    interface CategoryPayload {
      id: string;
      name: string;
      description?: string;
      attributeKeys?: string[];
    }

    it('creates, lists, fetches and updates a category', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'categories-owner@korva.test',
        'Categories Org',
      );

      const createRes = await request(server)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Clothing',
          description: 'Apparel and accessories',
          attributeKeys: ['couleur', 'taille'],
        })
        .expect(201);
      const category = asSuccess<CategoryPayload>(createRes.body);
      expect(category.name).toBe('Clothing');
      expect(category.attributeKeys).toEqual(['couleur', 'taille']);

      const listRes = await request(server)
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(
        asSuccess<CategoryPayload[]>(listRes.body).map((c) => c.id),
      ).toContain(category.id);

      const getRes = await request(server)
        .get(`/api/v1/categories/${category.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<CategoryPayload>(getRes.body).name).toBe('Clothing');

      const updateRes = await request(server)
        .patch(`/api/v1/categories/${category.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ description: 'Updated description' })
        .expect(200);
      expect(asSuccess<CategoryPayload>(updateRes.body).description).toBe(
        'Updated description',
      );
    });

    it('rejects creating two categories with the same name in the same organization', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'categories-dup@korva.test',
        'Categories Dup Org',
      );

      await request(server)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ name: 'Furniture' })
        .expect(201);

      const res = await request(server)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ name: 'Furniture' })
        .expect(409);
      expect(asError(res.body).code).toBe('CATEGORY_EXISTS');
    });

    it('returns 404 for a category that does not exist', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'categories-missing@korva.test',
        'Categories Missing Org',
      );

      const res = await request(server)
        .get('/api/v1/categories/000000000000000000000000')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(404);
      expect(asError(res.body).code).toBe('CATEGORY_NOT_FOUND');
    });

    it('deletes a category referenced by nothing', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'categories-delete-unused@korva.test',
        'Categories Delete Unused Org',
      );

      const createRes = await request(server)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ name: 'Unused' })
        .expect(201);
      const categoryId = asSuccess<CategoryPayload>(createRes.body).id;

      await request(server)
        .delete(`/api/v1/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);

      await request(server)
        .get(`/api/v1/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(404);
    });

    it('blocks deletion of a category still referenced by an offer, and allows it once the reference is removed', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'categories-in-use@korva.test',
        'Categories In Use Org',
      );

      const categoryRes = await request(server)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ name: 'Electronics' })
        .expect(201);
      const categoryId = asSuccess<CategoryPayload>(categoryRes.body).id;

      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Headphones',
          categories: ['Electronics'],
          pricing: { amount: 49, currency: 'EUR' },
        })
        .expect(201);
      const offerId = asSuccess<OfferPayload>(offerRes.body).id;

      const blockedRes = await request(server)
        .delete(`/api/v1/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(409);
      expect(asError(blockedRes.body).code).toBe('CATEGORY_IN_USE');

      await request(server)
        .get(`/api/v1/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);

      // Remove the offer's only reference to the category, then deletion succeeds.
      await request(server)
        .patch(`/api/v1/offers/${offerId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ categories: [] })
        .expect(200);

      await request(server)
        .delete(`/api/v1/categories/${categoryId}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
    });

    it('denies a user from another organization reading, updating or deleting a category via a foreign org id', async () => {
      const a = await registerOrgAndToken(
        'categories-iso-a@korva.test',
        'Categories Iso A',
      );
      const b = await registerOrgAndToken(
        'categories-iso-b@korva.test',
        'Categories Iso B',
      );

      const categoryRes = await request(server)
        .post('/api/v1/categories')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .send({ name: 'Org A Only' })
        .expect(201);
      const categoryId = asSuccess<CategoryPayload>(categoryRes.body).id;

      // Cross-org header entirely: TenantGuard rejects before the handler runs.
      const crossOrgRes = await request(server)
        .get(`/api/v1/categories/${categoryId}`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .expect(403);
      expect(asError(crossOrgRes.body).code).toBe('ORGANIZATION_ACCESS_DENIED');

      // Same-org header for B, but the category belongs to A: must 404, not leak/modify it.
      const getRes = await request(server)
        .get(`/api/v1/categories/${categoryId}`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', b.organizationId)
        .expect(404);
      expect(asError(getRes.body).code).toBe('CATEGORY_NOT_FOUND');

      const updateRes = await request(server)
        .patch(`/api/v1/categories/${categoryId}`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', b.organizationId)
        .send({ description: 'hijacked' })
        .expect(404);
      expect(asError(updateRes.body).code).toBe('CATEGORY_NOT_FOUND');

      const deleteRes = await request(server)
        .delete(`/api/v1/categories/${categoryId}`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', b.organizationId)
        .expect(404);
      expect(asError(deleteRes.body).code).toBe('CATEGORY_NOT_FOUND');

      const listRes = await request(server)
        .get('/api/v1/categories')
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', b.organizationId)
        .expect(200);
      expect(asSuccess<CategoryPayload[]>(listRes.body)).toHaveLength(0);
    });
  });

  describe('file/image uploads (shared/storage, local filesystem provider)', () => {
    interface UploadPayload {
      url: string;
      filename: string;
      mimeType: string;
      size: number;
    }

    // Real PNG magic bytes (0x89 'PNG' \r\n \x1a \n) followed by filler content — the server
    // never decodes image structure, only streams bytes back, so this is enough to prove a
    // genuine byte-for-byte round trip without needing a fully valid PNG.
    const pngBuffer = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(256, 7),
    ]);

    it('uploads an image and the returned URL serves back the exact same bytes', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'uploads-owner@korva.test',
        'Uploads Org',
      );

      const uploadRes = await request(server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .attach('file', pngBuffer, 'photo.png')
        .expect(201);
      const upload = asSuccess<UploadPayload>(uploadRes.body);
      expect(upload.mimeType).toBe('image/png');
      expect(upload.size).toBe(pngBuffer.length);
      expect(upload.url).toBe(
        `${process.env.API_URL ?? 'http://localhost:4000'}/api/v1/uploads/${organizationId}/${upload.filename}`,
      );

      // GET is deliberately unauthenticated — these URLs are meant to be used as offer image
      // <img src> on public storefront pages, which cannot attach an Authorization header.
      // supertest concatenates its own ephemeral base onto whatever string it's given, so an
      // absolute URL must be reduced to its path first.
      const fileRes = await request(server)
        .get(new URL(upload.url).pathname)
        .expect(200);
      expect(fileRes.headers['content-type']).toBe('image/png');
      expect(Buffer.compare(fileRes.body as Buffer, pngBuffer)).toBe(0);

      // And the URL is genuinely usable in Offer.images.
      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Photographed Product',
          images: [upload.url],
          pricing: { amount: 15, currency: 'EUR' },
        })
        .expect(201);
      const created = asSuccess<{ id: string; images: string[] }>(
        offerRes.body,
      );
      expect(created.images).toEqual([upload.url]);

      // Ten photos per offer, enforced by the API rather than only by the dashboard. The same URL
      // repeated is enough: the cap counts entries, it does not deduplicate.
      const offerPath = `/api/v1/offers/${created.id}`;
      const tooMany = await request(server)
        .patch(offerPath)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ images: Array.from({ length: 11 }, () => upload.url) })
        .expect(400);
      expect(asError(tooMany.body).code).toBe('VALIDATION_ERROR');

      const atLimit = await request(server)
        .patch(offerPath)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ images: Array.from({ length: 10 }, () => upload.url) })
        .expect(200);
      expect(asSuccess<{ images: string[] }>(atLimit.body).images).toHaveLength(
        10,
      );
    });

    it('rejects an upload with no file attached', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'uploads-empty@korva.test',
        'Uploads Empty Org',
      );

      const res = await request(server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(400);
      expect(asError(res.body).code).toBe('FILE_REQUIRED');
    });

    it('rejects a file whose type is not an allowed image mimetype', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'uploads-badtype@korva.test',
        'Uploads Bad Type Org',
      );

      const res = await request(server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .attach('file', Buffer.from('just some text'), {
          filename: 'notes.txt',
          contentType: 'text/plain',
        })
        .expect(400);
      expect(asError(res.body).code).toBe('UNSUPPORTED_FILE_TYPE');
    });

    it('rejects a file whose real bytes do not match its declared (spoofable) Content-Type, and serves genuine uploads with X-Content-Type-Options: nosniff', async () => {
      // fileFilter and the mimetype->extension lookup only ever see the client-supplied
      // multipart Content-Type field, never the actual bytes — before LocalDiskStorageEngine's
      // magic-byte check, this exact request (a plain-text payload declared as image/png) would
      // have been accepted, written to disk as `<uuid>.png`, and served back at a public URL
      // with `Content-Type: image/png`, a content-type-confusion risk on a public endpoint.
      // Shares one registration with the nosniff-header assertion below (rather than two
      // separate tests) to avoid tripping AuthController's AUTH_THROTTLE (30 req/60s) when this
      // describe block's already-numerous /auth/register calls run back-to-back.
      const { accessToken, organizationId } = await registerOrgAndToken(
        'uploads-spoofed@korva.test',
        'Uploads Spoofed Org',
      );

      const spoofedRes = await request(server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .attach('file', Buffer.from('<script>alert(1)</script>'), {
          filename: 'fake.png',
          contentType: 'image/png',
        })
        .expect(415);
      expect(asError(spoofedRes.body).code).toBe('UNSUPPORTED_FILE_TYPE');

      const uploadRes = await request(server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .attach('file', pngBuffer, 'photo.png')
        .expect(201);
      const upload = asSuccess<UploadPayload>(uploadRes.body);

      const fileRes = await request(server)
        .get(new URL(upload.url).pathname)
        .expect(200);
      expect(fileRes.headers['x-content-type-options']).toBe('nosniff');
    });

    it('rejects a file over the size limit', async () => {
      const { accessToken, organizationId } = await registerOrgAndToken(
        'uploads-oversized@korva.test',
        'Uploads Oversized Org',
      );

      // Starts with real PNG magic bytes so this exercises the size limit specifically (413),
      // not the unrelated magic-byte signature check (415) added alongside it.
      const oversizedBuffer = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(6 * 1024 * 1024, 1), // 6MB > 5MB limit
      ]);
      const res = await request(server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .attach('file', oversizedBuffer, 'big.png')
        .expect(413);
      expect(asError(res.body).code).toBe('PAYLOAD_TOO_LARGE');
    });

    it("denies deleting another organization's uploaded file, while the owning organization can", async () => {
      const a = await registerOrgAndToken(
        'uploads-iso-a@korva.test',
        'Uploads Iso A',
      );
      const b = await registerOrgAndToken(
        'uploads-iso-b@korva.test',
        'Uploads Iso B',
      );

      const uploadRes = await request(server)
        .post('/api/v1/uploads')
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .attach('file', pngBuffer, 'photo.png')
        .expect(201);
      const upload = asSuccess<UploadPayload>(uploadRes.body);

      const deniedRes = await request(server)
        .delete(`/api/v1/uploads/${a.organizationId}/${upload.filename}`)
        .set('Authorization', `Bearer ${b.accessToken}`)
        .set('X-Organization-Id', b.organizationId)
        .expect(404);
      expect(asError(deniedRes.body).code).toBe('FILE_NOT_FOUND');

      // Still there — the denied attempt must not have deleted it.
      await request(server).get(new URL(upload.url).pathname).expect(200);

      await request(server)
        .delete(`/api/v1/uploads/${a.organizationId}/${upload.filename}`)
        .set('Authorization', `Bearer ${a.accessToken}`)
        .set('X-Organization-Id', a.organizationId)
        .expect(200);

      await request(server).get(new URL(upload.url).pathname).expect(404);
    });
  });
});
