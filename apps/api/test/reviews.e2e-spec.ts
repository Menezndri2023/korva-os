import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PlatformAdminAuthService } from './../src/platform-admin/platform-admin-auth.service';
import { putOrganizationOnPlan } from './support/plan-tier';

interface ApiSuccess<T> {
  success: true;
  data: T;
}
interface ApiError {
  success: false;
  error: { code: string; message: string };
}
interface PublicReview {
  rating: number;
  comment?: string;
  authorName?: string;
  offerName?: string;
  reply?: { body: string };
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

/**
 * Reviews, both kinds:
 * - a business's customers reviewing it, from the link sent once an order is delivered or a
 *   booking completed (no account needed), moderated and answered by the business;
 * - businesses reviewing KORVA OS, moderated by the administration before korvasuite.com shows
 *   them. Own file: the public review route has a 5/min budget per app instance.
 */
describe('Reviews (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;
  let connection: Connection;

  beforeAll(async () => {
    process.env.PLATFORM_ADMIN_EMAILS = 'reviews-ops@korva.test';
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
    delete process.env.PLATFORM_ADMIN_EMAILS;
    await connection.dropDatabase();
    await app.close();
  });

  async function setupBusiness(email: string, name: string, type: string) {
    const authRes = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'password123', firstName: 'Mariam' })
      .expect(201);
    const token = asSuccess<{ accessToken: string }>(authRes.body).accessToken;
    const orgRes = await request(server)
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name,
        type,
        country: 'CI',
        currency: 'XOF',
        timezone: 'Africa/Abidjan',
        language: 'fr',
      })
      .expect(201);
    const org = asSuccess<{ id: string; slug: string }>(orgRes.body);
    await putOrganizationOnPlan(connection, org.id, 'business');
    const staff = (req: request.Test) =>
      req
        .set('Authorization', `Bearer ${token}`)
        .set('X-Organization-Id', org.id);
    await staff(request(server).patch('/api/v1/organizations/me'))
      .send({
        enabledModules: ['crm', 'catalog', 'commerce', 'booking', 'website'],
      })
      .expect(200);
    const contactRes = await staff(request(server).post('/api/v1/contacts'))
      .send({
        type: 'person',
        firstName: 'Awa',
        lastName: 'Koné',
        email: `client-${org.slug}@example.com`,
      })
      .expect(201);
    const contactId = asSuccess<{ id: string }>(contactRes.body).id;
    return { token, org, staff, contactId };
  }

  async function createOffer(
    staff: (req: request.Test) => request.Test,
    type: 'product' | 'booking',
    name: string,
  ) {
    const res = await staff(request(server).post('/api/v1/offers'))
      .send({
        type,
        name,
        status: 'active',
        pricing: { amount: 5000, currency: 'XOF' },
      })
      .expect(201);
    return asSuccess<{ id: string }>(res.body).id;
  }

  async function deliverOrder(
    staff: (req: request.Test) => request.Test,
    contactId: string,
    offerId: string,
    description: string,
  ) {
    const res = await staff(request(server).post('/api/v1/orders'))
      .send({
        contactId,
        items: [{ offerId, description, quantity: 1, unitPrice: 5000 }],
        currency: 'XOF',
      })
      .expect(201);
    const orderId = asSuccess<{ id: string }>(res.body).id;
    await staff(
      request(server).post(`/api/v1/orders/${orderId}/confirm`),
    ).expect(201);
    await staff(
      request(server).post(`/api/v1/orders/${orderId}/fulfill`),
    ).expect(201);
    return orderId;
  }

  /** The review request goes through the business's conversations (WhatsApp, else email). */
  async function lastMessageTo(contactId: string): Promise<string | undefined> {
    const conversations = await connection
      .collection('conversations')
      .find({ contactId: new Types.ObjectId(contactId) })
      .toArray();
    const message = await connection
      .collection('messages')
      .find({ conversationId: { $in: conversations.map((c) => c._id) } })
      .sort({ _id: -1 })
      .limit(1)
      .next();
    return message?.body as string | undefined;
  }

  function tokenIn(body: string | undefined): string {
    const match = body?.match(/\/avis\?t=([A-Za-z0-9_.-]+)/);
    expect(match).toBeTruthy();
    return match![1]!;
  }

  describe("a business's customers", () => {
    let shop: Awaited<ReturnType<typeof setupBusiness>>;
    let offerId: string;
    let token: string;

    beforeAll(async () => {
      shop = await setupBusiness(
        'review-shop@korva.test',
        'Chez Awa',
        'commerce',
      );
      offerId = await createOffer(shop.staff, 'product', 'Attiéké poisson');
      await deliverOrder(
        shop.staff,
        shop.contactId,
        offerId,
        'Attiéké poisson',
      );
    });

    it('asks for a review once the order is delivered, with a link that proves the purchase', async () => {
      const body = await lastMessageTo(shop.contactId);
      expect(body).toContain('Bonjour Awa');
      expect(body).toContain('Chez Awa');
      expect(body).toContain(`/${shop.org.slug}/avis?t=`);
      token = tokenIn(body);
    });

    it('opens the link on what is being reviewed', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${shop.org.slug}/review-invitation`)
        .query({ token })
        .expect(200);
      expect(asSuccess(res.body)).toEqual({
        organizationName: 'Chez Awa',
        entity: 'order',
        items: ['Attiéké poisson'],
        customerFirstName: 'Awa',
        alreadyReviewed: false,
      });
    });

    it('refuses a forged link, and a link used on another business', async () => {
      const [body, signature] = token.split('.');
      const forged = `${body}.${signature!.slice(0, -2)}xx`;
      const res = await request(server)
        .get(`/api/v1/public/${shop.org.slug}/review-invitation`)
        .query({ token: forged })
        .expect(404);
      expect(asError(res.body).code).toBe('REVIEW_INVITATION_INVALID');

      const other = await setupBusiness(
        'review-other@korva.test',
        'Autre Shop',
        'commerce',
      );
      await request(server)
        .get(`/api/v1/public/${other.org.slug}/review-invitation`)
        .query({ token })
        .expect(404);
    });

    it('takes one review per order, signed with the first name when asked', async () => {
      await request(server)
        .post(`/api/v1/public/${shop.org.slug}/reviews`)
        .send({
          token,
          rating: 4,
          comment: 'Très bon, livré chaud.',
          showName: true,
        })
        .expect(201);
      const again = await request(server)
        .post(`/api/v1/public/${shop.org.slug}/reviews`)
        .send({ token, rating: 1 })
        .expect(409);
      expect(asError(again.body).code).toBe('REVIEW_ALREADY_EXISTS');

      const invitation = await request(server)
        .get(`/api/v1/public/${shop.org.slug}/review-invitation`)
        .query({ token })
        .expect(200);
      expect(
        asSuccess<{ alreadyReviewed: boolean }>(invitation.body)
          .alreadyReviewed,
      ).toBe(true);
    });

    it("shows on the site's home page and on the offer page", async () => {
      const home = await request(server)
        .get(`/api/v1/public/${shop.org.slug}`)
        .expect(200);
      const summary = asSuccess<{
        reviewSummary: {
          average: number;
          count: number;
          latest: PublicReview[];
        };
      }>(home.body).reviewSummary;
      expect(summary.average).toBe(4);
      expect(summary.count).toBe(1);
      expect(summary.latest[0]).toMatchObject({
        rating: 4,
        comment: 'Très bon, livré chaud.',
        authorName: 'Awa K.',
        offerName: 'Attiéké poisson',
      });
      // Nothing that identifies the customer beyond what they chose to show.
      expect(JSON.stringify(summary)).not.toContain('example.com');
      expect(JSON.stringify(summary)).not.toContain(shop.contactId);

      const offer = await request(server)
        .get(`/api/v1/public/${shop.org.slug}/offers/${offerId}/reviews`)
        .expect(200);
      expect(asSuccess<{ count: number }>(offer.body).count).toBe(1);
    });

    it('lets the business answer publicly, and take a review off the site', async () => {
      const list = await shop
        .staff(request(server).get('/api/v1/reviews'))
        .expect(200);
      const [review] = asSuccess<{ id: string; offerName?: string }[]>(
        list.body,
      );
      expect(review!.offerName).toBe('Attiéké poisson');

      await shop
        .staff(request(server).patch(`/api/v1/reviews/${review!.id}/reply`))
        .send({ body: 'Merci Awa, à bientôt !' })
        .expect(200);
      let home = await request(server)
        .get(`/api/v1/public/${shop.org.slug}`)
        .expect(200);
      expect(
        asSuccess<{ reviewSummary: { latest: PublicReview[] } }>(home.body)
          .reviewSummary.latest[0]!.reply?.body,
      ).toBe('Merci Awa, à bientôt !');

      await shop
        .staff(request(server).patch(`/api/v1/reviews/${review!.id}/status`))
        .send({ status: 'hidden' })
        .expect(200);
      home = await request(server)
        .get(`/api/v1/public/${shop.org.slug}`)
        .expect(200);
      expect(
        asSuccess<{ reviewSummary: { count: number; average: number | null } }>(
          home.body,
        ).reviewSummary,
      ).toMatchObject({ count: 0, average: null });
      const offer = await request(server)
        .get(`/api/v1/public/${shop.org.slug}/offers/${offerId}/reviews`)
        .expect(200);
      expect(asSuccess<{ count: number }>(offer.body).count).toBe(0);

      // The owner still sees everything, hidden included.
      const stats = await shop
        .staff(request(server).get('/api/v1/reviews/stats'))
        .expect(200);
      expect(asSuccess(stats.body)).toEqual({
        average: 4,
        count: 1,
        hidden: 1,
        distribution: [0, 0, 0, 1, 0],
        requestsEnabled: true,
      });
    });

    it('sends nothing once the business switches review requests off', async () => {
      await shop
        .staff(request(server).patch('/api/v1/organizations/me'))
        .send({ reviewRequestsEnabled: false })
        .expect(200);
      const before = await lastMessageTo(shop.contactId);
      await deliverOrder(
        shop.staff,
        shop.contactId,
        offerId,
        'Attiéké poisson',
      );
      expect(await lastMessageTo(shop.contactId)).toBe(before);
    });
  });

  describe('a completed booking', () => {
    it('thanks the client in words that fit the business, with the review link', async () => {
      const salon = await setupBusiness(
        'review-salon@korva.test',
        'Salon Belle',
        'beauté',
      );
      const offerId = await createOffer(salon.staff, 'booking', 'Tresses');
      const resources = await salon
        .staff(request(server).get('/api/v1/resources'))
        .expect(200);
      const resourceId = asSuccess<{ id: string }[]>(resources.body)[0]!.id;
      const start = new Date();
      start.setUTCDate(start.getUTCDate() + 7);
      // A Wednesday 10:00 in Abidjan (UTC+0), inside the default Mon–Sat 09–18 hours.
      while (start.getUTCDay() !== 3) start.setUTCDate(start.getUTCDate() + 1);
      start.setUTCHours(10, 0, 0, 0);
      const bookingRes = await salon
        .staff(request(server).post('/api/v1/bookings'))
        .send({
          resourceId,
          offerId,
          contactId: salon.contactId,
          startAt: start.toISOString(),
          endAt: new Date(start.getTime() + 3_600_000).toISOString(),
        })
        .expect(201);
      const bookingId = asSuccess<{ id: string }>(bookingRes.body).id;
      await salon
        .staff(request(server).post(`/api/v1/bookings/${bookingId}/complete`))
        .send({ attended: true })
        .expect(201);

      const body = await lastMessageTo(salon.contactId);
      expect(body).toContain(
        'merci d’avoir choisi Salon Belle pour « Tresses »',
      );
      expect(body).not.toContain('formation');
      const res = await request(server)
        .get(`/api/v1/public/${salon.org.slug}/review-invitation`)
        .query({ token: tokenIn(body) })
        .expect(200);
      expect(
        asSuccess<{ entity: string; items: string[] }>(res.body),
      ).toMatchObject({
        entity: 'booking',
        items: ['Tresses'],
      });
    });
  });

  describe('reviews of KORVA OS', () => {
    let adminToken: string;
    let business: Awaited<ReturnType<typeof setupBusiness>>;

    beforeAll(async () => {
      const { password } = await app
        .get(PlatformAdminAuthService)
        .provision('reviews-ops@korva.test');
      const res = await request(server)
        .post('/api/v1/platform/auth/login')
        .send({ email: 'reviews-ops@korva.test', password })
        .expect(200);
      adminToken = asSuccess<{ accessToken: string }>(res.body).accessToken;
      business = await setupBusiness(
        'review-korva@korva.test',
        'Boutique Mariam',
        'commerce',
      );
    });

    const admin = (req: request.Test) =>
      req.set('Authorization', `Bearer ${adminToken}`);

    it('starts empty, then keeps what the business wrote', async () => {
      const empty = await business
        .staff(request(server).get('/api/v1/platform-reviews/me'))
        .expect(200);
      expect(asSuccess(empty.body)).toBeNull();

      const saved = await business
        .staff(request(server).patch('/api/v1/platform-reviews/me'))
        .send({
          rating: 5,
          comment: 'Mon site en dix minutes.',
          publicConsent: false,
        })
        .expect(200);
      expect(asSuccess(saved.body)).toMatchObject({
        rating: 5,
        status: 'pending',
        displayName: 'Mariam',
        businessName: 'Boutique Mariam',
      });
    });

    it('is closed to businesses on the moderation side', async () => {
      await business
        .staff(request(server).get('/api/v1/platform/reviews'))
        .expect(403);
    });

    it('never publishes a review whose author did not agree to it', async () => {
      const list = await admin(
        request(server).get('/api/v1/platform/reviews'),
      ).expect(200);
      const [row] = asSuccess<{ id: string; authorEmail: string }[]>(list.body);
      expect(row!.authorEmail).toBe('review-korva@korva.test');
      const res = await admin(
        request(server).post(`/api/v1/platform/reviews/${row!.id}/moderate`),
      )
        .send({ status: 'published' })
        .expect(400);
      expect(asError(res.body).code).toBe('REVIEW_NOT_CONSENTED');
    });

    it('shows a published, consented review on korvasuite.com — until it is edited again', async () => {
      await business
        .staff(request(server).patch('/api/v1/platform-reviews/me'))
        .send({
          rating: 5,
          comment: 'Mon site en dix minutes.',
          publicConsent: true,
        })
        .expect(200);
      const list = await admin(
        request(server)
          .get('/api/v1/platform/reviews')
          .query({ status: 'pending' }),
      ).expect(200);
      const [row] = asSuccess<{ id: string }[]>(list.body);
      await admin(
        request(server).post(`/api/v1/platform/reviews/${row!.id}/moderate`),
      )
        .send({ status: 'published' })
        .expect(200);

      let page = await request(server)
        .get('/api/v1/public-platform-reviews')
        .expect(200);
      expect(asSuccess(page.body)).toMatchObject({
        average: 5,
        count: 1,
        reviews: [
          {
            rating: 5,
            comment: 'Mon site en dix minutes.',
            displayName: 'Mariam',
            businessName: 'Boutique Mariam',
            businessModel: 'retail',
          },
        ],
      });
      expect(JSON.stringify(page.body)).not.toContain(
        'review-korva@korva.test',
      );

      await business
        .staff(request(server).patch('/api/v1/platform-reviews/me'))
        .send({
          rating: 3,
          comment: 'Finalement, il manque des choses.',
          publicConsent: true,
        })
        .expect(200);
      page = await request(server)
        .get('/api/v1/public-platform-reviews')
        .expect(200);
      expect(
        asSuccess<{ reviews: unknown[]; average: number }>(page.body),
      ).toMatchObject({
        reviews: [],
        average: 3,
      });
    });

    it('tells the author why a review was declined, and keeps it out of the average', async () => {
      const list = await admin(
        request(server).get('/api/v1/platform/reviews'),
      ).expect(200);
      const [row] = asSuccess<{ id: string }[]>(list.body);
      await admin(
        request(server).post(`/api/v1/platform/reviews/${row!.id}/moderate`),
      )
        .send({
          status: 'rejected',
          reason: 'Merci de préciser ce qui manque.',
        })
        .expect(200);
      const mine = await business
        .staff(request(server).get('/api/v1/platform-reviews/me'))
        .expect(200);
      expect(asSuccess(mine.body)).toMatchObject({
        status: 'rejected',
        rejectionReason: 'Merci de préciser ce qui manque.',
      });
      const stats = await admin(
        request(server).get('/api/v1/platform/reviews/stats'),
      ).expect(200);
      expect(asSuccess(stats.body)).toMatchObject({
        count: 0,
        rejected: 1,
        average: null,
      });
    });
  });
});
