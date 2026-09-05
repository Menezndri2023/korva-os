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
  slug: string;
}
interface OfferPayload {
  id: string;
  name: string;
  variants: {
    id: string;
    name: string;
    sku?: string;
    priceOverride?: number;
  }[];
}
interface ResourcePayload {
  id: string;
}
interface PublicOfferPayload {
  id: string;
  name: string;
  categories: string[];
  pricing: { amount: number; currency: string };
  variants: {
    id: string;
    name: string;
    sku?: string;
    priceOverride?: number;
  }[];
}
interface ApiPaginatedSuccess<T> {
  success: true;
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
interface PublicBookingPayload {
  id: string;
  status: string;
}
interface PublicOrderPayload {
  id: string;
  number: string;
  total: number;
  status: string;
}
interface FullOrderPayload {
  id: string;
  total: number;
  subtotal: number;
  shippingCost: number;
  shippingAddress?: {
    line1: string;
    city: string;
    postalCode: string;
    country: string;
  };
  discountCodeId?: string;
  items: {
    offerId?: string;
    variantId?: string;
    description: string;
    unitPrice: number;
  }[];
}
interface PublicOrganizationPayload {
  name: string;
  type: string;
  enabledModules: string[];
  logo?: string;
  brandColor?: string;
  tagline?: string;
  heroImage?: string;
  visibleSections: string[];
  shippingFlatRate?: number;
  storefrontTheme: {
    template: string;
    palette?: string;
    fontPairing: string;
    customAccentApplied: boolean;
  };
  aboutText?: string;
  testimonials?: { id: string; authorName: string; quote: string }[];
  teamMembers?: { id: string; name: string; role: string }[];
  galleryImages?: { id: string; url: string }[];
  faqItems?: { id: string; question: string; answer: string }[];
}
interface TrackedOrderPayload {
  number: string;
  status: string;
  total: number;
  currency: string;
  items: { description: string; quantity: number; unitPrice: number }[];
}
interface TrackedBookingPayload {
  id: string;
  status: string;
  startAt: string;
  endAt: string;
}

function asSuccess<T>(body: unknown): T {
  return (body as ApiSuccess<T>).data;
}
function asError(body: unknown): ApiError['error'] {
  return (body as ApiError).error;
}

/** Polls `check` until it returns a defined value (the Decision Engine processes events
 *  asynchronously via a real Redis-backed BullMQ queue, not synchronously with the triggering
 *  request) or times out. */
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

describe('Public storefront API (e2e)', () => {
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

  async function setupStorefrontOrg(
    email: string,
    orgName: string,
    // "crm" isn't part of what these tests are proving about the public storefront (that's
    // catalog/booking/commerce, checked below via assertModuleEnabled) — it's included here
    // only so the internal GET /contacts calls these tests use to verify a public order/booking
    // created the expected contact are themselves allowed by ModuleGuard. "website" gates
    // GET /public/:slug itself (see "module gating and unknown organizations" below) — included
    // by default so every other describe block's use of that endpoint keeps working unchanged.
    modules: string[] = ['catalog', 'booking', 'commerce', 'crm', 'website'],
  ) {
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

    await request(server)
      .patch('/api/v1/organizations/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('X-Organization-Id', organization.id)
      .send({ enabledModules: modules })
      .expect(200);

    return {
      accessToken,
      organizationId: organization.id,
      slug: organization.slug,
    };
  }

  describe('offers catalog and checkout', () => {
    let accessToken: string;
    let organizationId: string;
    let slug: string;
    let activeOfferId: string;

    async function createVariantOffer(): Promise<{
      offerId: string;
      variantId: string;
    }> {
      const res = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Hoodie',
          status: 'active',
          pricing: { amount: 40, currency: 'EUR' },
          variants: [{ name: 'Large', sku: 'HOOD-L', priceOverride: 45 }],
        })
        .expect(201);
      const offer = asSuccess<OfferPayload>(res.body);
      return { offerId: offer.id, variantId: offer.variants[0]!.id };
    }

    beforeAll(async () => {
      ({ accessToken, organizationId, slug } = await setupStorefrontOrg(
        'storefront-owner@korva.test',
        'Storefront Org',
      ));

      const activeOfferRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'T-Shirt',
          status: 'active',
          pricing: { amount: 25, currency: 'EUR' },
        })
        .expect(201);
      activeOfferId = asSuccess<OfferPayload>(activeOfferRes.body).id;

      await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Unreleased Product',
          status: 'draft',
          pricing: { amount: 999, currency: 'EUR' },
        })
        .expect(201);
    });

    it('exposes only safe organization fields publicly', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slug}`)
        .expect(200);
      const info = asSuccess<{ name: string; enabledModules: string[] }>(
        res.body,
      );
      expect(info.name).toBe('Storefront Org');
      expect(info.enabledModules).toEqual(
        expect.arrayContaining(['catalog', 'booking', 'commerce']),
      );
    });

    it('lists only active offers publicly, with no authentication', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slug}/offers`)
        .expect(200);
      const offers = asSuccess<PublicOfferPayload[]>(res.body);
      expect(offers).toHaveLength(1);
      expect(offers[0]!.name).toBe('T-Shirt');
    });

    it('searchOffers paginates/sorts/filters over the FULL active catalog, unlike the 50-item preview', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slug}/offers/search`)
        .expect(200);
      const body = res.body as ApiPaginatedSuccess<PublicOfferPayload>;
      expect(body.data).toHaveLength(1);
      expect(body.data[0]!.name).toBe('T-Shirt');
      expect(body.pagination).toEqual({
        page: 1,
        limit: 24,
        total: 1,
        totalPages: 1,
      });

      const page2 = await request(server)
        .get(`/api/v1/public/${slug}/offers/search`)
        .query({ page: 2, limit: 1 })
        .expect(200);
      expect(
        (page2.body as ApiPaginatedSuccess<PublicOfferPayload>).data,
      ).toHaveLength(0);

      const priceDesc = await request(server)
        .get(`/api/v1/public/${slug}/offers/search`)
        .query({ sort: 'price_desc' })
        .expect(200);
      expect(
        (priceDesc.body as ApiPaginatedSuccess<PublicOfferPayload>).data[0]!
          .name,
      ).toBe('T-Shirt');

      const noMatch = await request(server)
        .get(`/api/v1/public/${slug}/offers/search`)
        .query({ search: 'does-not-exist-anywhere' })
        .expect(200);
      expect(
        (noMatch.body as ApiPaginatedSuccess<PublicOfferPayload>).data,
      ).toHaveLength(0);

      // The draft "Unreleased Product" must never surface, whatever the filter combination.
      const all = await request(server)
        .get(`/api/v1/public/${slug}/offers/search`)
        .query({ limit: 48 })
        .expect(200);
      expect(
        (all.body as ApiPaginatedSuccess<PublicOfferPayload>).data.some(
          (o) => o.name === 'Unreleased Product',
        ),
      ).toBe(false);
    });

    it('listOfferCategories only reflects categories on active offers', async () => {
      const categorizedRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Sneakers',
          status: 'active',
          categories: ['chaussures'],
          pricing: { amount: 80, currency: 'EUR' },
        })
        .expect(201);
      expect(asSuccess<OfferPayload>(categorizedRes.body).name).toBe(
        'Sneakers',
      );

      const res = await request(server)
        .get(`/api/v1/public/${slug}/offers/categories`)
        .expect(200);
      expect(asSuccess<string[]>(res.body)).toEqual(['chaussures']);

      const filtered = await request(server)
        .get(`/api/v1/public/${slug}/offers/search`)
        .query({ category: 'chaussures' })
        .expect(200);
      const filteredBody =
        filtered.body as ApiPaginatedSuccess<PublicOfferPayload>;
      expect(filteredBody.data).toHaveLength(1);
      expect(filteredBody.data[0]!.name).toBe('Sneakers');
    });

    it('getOffer returns the real active offer by id', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slug}/offers/${activeOfferId}`)
        .expect(200);
      expect(asSuccess<PublicOfferPayload>(res.body).name).toBe('T-Shirt');
    });

    it('getOffer returns a generic 404 for a draft offer, an unknown id, and a malformed id alike', async () => {
      const draftOfferRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Still A Draft',
          status: 'draft',
          pricing: { amount: 10, currency: 'EUR' },
        })
        .expect(201);
      const draftOfferId = asSuccess<OfferPayload>(draftOfferRes.body).id;

      const draft = await request(server)
        .get(`/api/v1/public/${slug}/offers/${draftOfferId}`)
        .expect(404);
      expect(asError(draft.body).code).toBe('OFFER_NOT_FOUND');

      const unknown = await request(server)
        .get(`/api/v1/public/${slug}/offers/${new Types.ObjectId().toString()}`)
        .expect(404);
      expect(asError(unknown.body).code).toBe('OFFER_NOT_FOUND');

      const malformed = await request(server)
        .get(`/api/v1/public/${slug}/offers/not-an-object-id`)
        .expect(404);
      expect(asError(malformed.body).code).toBe('OFFER_NOT_FOUND');
    });

    it('creates a public order, always pricing from the real offer server-side', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/orders`)
        .send({
          items: [{ offerId: activeOfferId, quantity: 3 }],
          currency: 'EUR',
          contact: { email: 'guest@customer.test', firstName: 'Guest' },
        })
        .expect(201);
      const order = asSuccess<PublicOrderPayload>(res.body);
      expect(order.total).toBe(75);
      expect(order.status).toBe('pending');

      const contactsRes = await request(server)
        .get('/api/v1/contacts?search=guest@customer.test')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<{ email?: string }[]>(contactsRes.body)).toHaveLength(1);
    });

    it('reuses the same contact for a second public order from the same email', async () => {
      await request(server)
        .post(`/api/v1/public/${slug}/orders`)
        .send({
          items: [{ offerId: activeOfferId, quantity: 1 }],
          currency: 'EUR',
          contact: { email: 'guest@customer.test' },
        })
        .expect(201);

      const contactsRes = await request(server)
        .get('/api/v1/contacts?search=guest@customer.test')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<{ email?: string }[]>(contactsRes.body)).toHaveLength(1);
    });

    it('rejects a public order for an offer that does not exist', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/orders`)
        .send({
          items: [{ offerId: '000000000000000000000000', quantity: 1 }],
          currency: 'EUR',
          contact: { email: 'ghost@customer.test' },
        })
        .expect(404);
      expect(asError(res.body).code).toBe('OFFER_NOT_FOUND');
    });

    it('prices a public order line from the selected variant, not the base offer price', async () => {
      const { offerId: variantOfferId, variantId: largeVariantId } =
        await createVariantOffer();
      const res = await request(server)
        .post(`/api/v1/public/${slug}/orders`)
        .send({
          items: [
            { offerId: variantOfferId, variantId: largeVariantId, quantity: 1 },
          ],
          currency: 'EUR',
          contact: { email: 'variant-buyer@customer.test' },
        })
        .expect(201);
      const order = asSuccess<PublicOrderPayload>(res.body);
      expect(order.total).toBe(45);

      const orderDetailRes = await request(server)
        .get(`/api/v1/orders/${order.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const detail = asSuccess<FullOrderPayload>(orderDetailRes.body);
      expect(detail.items[0]!.variantId).toBe(largeVariantId);
      expect(detail.items[0]!.description).toContain('Large');
    });

    it('rejects a public order whose variantId does not belong to the given offer', async () => {
      const { offerId: variantOfferId } = await createVariantOffer();
      const res = await request(server)
        .post(`/api/v1/public/${slug}/orders`)
        .send({
          items: [
            {
              offerId: variantOfferId,
              variantId: new Types.ObjectId().toString(),
              quantity: 1,
            },
          ],
          currency: 'EUR',
          contact: { email: 'bad-variant@customer.test' },
        })
        .expect(404);
      expect(asError(res.body).code).toBe('VARIANT_NOT_FOUND');
    });

    it('applies a discount code and shipping cost at storefront checkout, and drops an incomplete shipping address rather than rejecting the order', async () => {
      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          enabledModules: [
            'catalog',
            'booking',
            'commerce',
            'crm',
            'finance',
            'website',
          ],
        })
        .expect(200);
      await request(server)
        .post('/api/v1/discount-codes')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ code: 'STORE10', type: 'fixed', value: 5, currency: 'EUR' })
        .expect(201);
      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ shippingFlatRate: 4 })
        .expect(200);

      const orgRes = await request(server)
        .get(`/api/v1/public/${slug}`)
        .expect(200);
      expect(
        asSuccess<PublicOrganizationPayload>(orgRes.body).shippingFlatRate,
      ).toBe(4);

      const res = await request(server)
        .post(`/api/v1/public/${slug}/orders`)
        .send({
          items: [{ offerId: activeOfferId, quantity: 1 }],
          currency: 'EUR',
          contact: { email: 'discount-shipping-buyer@customer.test' },
          discountCode: 'STORE10',
          // Incomplete on purpose (no city/postalCode/country) — must be silently dropped, not
          // rejected, since the whole shipping-address section is optional at checkout.
          shippingAddress: { line1: '12 Rue de la Paix' },
        })
        .expect(201);
      const order = asSuccess<PublicOrderPayload>(res.body);
      // 25 (offer) - 5 (discount) + 4 (shipping) = 24
      expect(order.total).toBe(24);

      const detailRes = await request(server)
        .get(`/api/v1/orders/${order.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const detail = asSuccess<FullOrderPayload>(detailRes.body);
      expect(detail.discountCodeId).toBeDefined();
      expect(detail.shippingCost).toBe(4);
      expect(detail.shippingAddress).toBeUndefined();
    });

    it('persists a complete shipping address on a public order', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/orders`)
        .send({
          items: [{ offerId: activeOfferId, quantity: 1 }],
          currency: 'EUR',
          contact: { email: 'shipping-buyer@customer.test' },
          shippingAddress: {
            line1: '12 Rue de la Paix',
            city: 'Paris',
            postalCode: '75002',
            country: 'France',
          },
        })
        .expect(201);
      const order = asSuccess<PublicOrderPayload>(res.body);

      const detailRes = await request(server)
        .get(`/api/v1/orders/${order.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const detail = asSuccess<FullOrderPayload>(detailRes.body);
      expect(detail.shippingAddress).toEqual({
        line1: '12 Rue de la Paix',
        city: 'Paris',
        postalCode: '75002',
        country: 'France',
      });
    });

    it("triggers a low-stock Recommendation once a public order depletes a tracked offer's stock", async () => {
      const trackedOfferRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Limited Mug',
          status: 'active',
          pricing: { amount: 15, currency: 'EUR' },
          trackStock: true,
          stockOnHand: 1,
        })
        .expect(201);
      const trackedOfferId = asSuccess<OfferPayload>(trackedOfferRes.body).id;

      await request(server)
        .post(`/api/v1/public/${slug}/orders`)
        .send({
          items: [{ offerId: trackedOfferId, quantity: 1 }],
          currency: 'EUR',
          contact: { email: 'last-mug-buyer@customer.test' },
        })
        .expect(201);

      const recommendation = await waitFor(async () => {
        const listRes = await request(server)
          .get('/api/v1/recommendations')
          .set('Authorization', `Bearer ${accessToken}`)
          .set('X-Organization-Id', organizationId)
          .expect(200);
        const recommendations = asSuccess<
          { entityType: string; entityId: string; title: string }[]
        >(listRes.body);
        return recommendations.find(
          (r) => r.entityType === 'offer' && r.entityId === trackedOfferId,
        );
      });
      expect(recommendation?.title).toBe('Stock épuisé');
    });
  });

  describe('storefront branding', () => {
    it('exposes logo and brandColor publicly once set, and omits brandColor when unset', async () => {
      const { accessToken, organizationId, slug } = await setupStorefrontOrg(
        'storefront-branding@korva.test',
        'Branding Storefront Org',
      );

      const before = await request(server)
        .get(`/api/v1/public/${slug}`)
        .expect(200);
      expect(
        asSuccess<PublicOrganizationPayload>(before.body).brandColor,
      ).toBeUndefined();

      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          logo: 'https://cdn.korva.test/logos/branding-storefront.png',
          brandColor: '#ff6600',
          tagline: 'Le meilleur salon de la ville',
          heroImage: 'https://cdn.korva.test/hero/branding-storefront.png',
        })
        .expect(200);

      const after = await request(server)
        .get(`/api/v1/public/${slug}`)
        .expect(200);
      const info = asSuccess<PublicOrganizationPayload>(after.body);
      expect(info.logo).toBe(
        'https://cdn.korva.test/logos/branding-storefront.png',
      );
      expect(info.brandColor).toBe('#ff6600');
      expect(info.tagline).toBe('Le meilleur salon de la ville');
      expect(info.heroImage).toBe(
        'https://cdn.korva.test/hero/branding-storefront.png',
      );
    });
  });

  describe('storefront theme resolution (packages/types storefront-themes.ts)', () => {
    it('defaults a brand-new (free-plan) organization to the "essentiel" template', async () => {
      const { slug } = await setupStorefrontOrg(
        'storefront-theme-default@korva.test',
        'Theme Default Org',
      );

      const res = await request(server)
        .get(`/api/v1/public/${slug}`)
        .expect(200);
      const info = asSuccess<PublicOrganizationPayload>(res.body);
      expect(info.storefrontTheme.template).toBe('essentiel');
      expect(info.storefrontTheme.palette).toBeUndefined();
    });

    it('resolves the vertical default template once the plan covers it, with a deterministic palette/font', async () => {
      const authRes = await request(server)
        .post('/api/v1/auth/register')
        .send({
          email: 'storefront-theme-vertical@korva.test',
          password: 'password123',
        })
        .expect(201);
      const accessToken = asSuccess<AuthPayload>(authRes.body).accessToken;

      // "commerce" matches VERTICAL_TEMPLATES' commerce entry (defaultStorefrontTemplate:
      // "boutique") — see packages/types/src/verticals.ts.
      const orgRes = await request(server)
        .post('/api/v1/organizations')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          name: 'Theme Vertical Org',
          type: 'commerce',
          country: 'FR',
          currency: 'EUR',
          timezone: 'Europe/Paris',
          language: 'fr',
        })
        .expect(201);
      const organization = asSuccess<OrganizationPayload>(orgRes.body);

      await request(server)
        .post('/api/v1/subscriptions/change-plan')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organization.id)
        .send({ planKey: 'starter' })
        .expect(201);

      const res = await request(server)
        .get(`/api/v1/public/${organization.slug}`)
        .expect(200);
      const theme = asSuccess<PublicOrganizationPayload>(
        res.body,
      ).storefrontTheme;
      expect(theme.template).toBe('boutique');
      expect(['marine', 'corail', 'graphite']).toContain(theme.palette);
      expect(['geometrique', 'sobre']).toContain(theme.fontPairing);

      // Deterministic, not random: refetching must yield the exact same palette/font every time.
      const again = await request(server)
        .get(`/api/v1/public/${organization.slug}`)
        .expect(200);
      const themeAgain = asSuccess<PublicOrganizationPayload>(
        again.body,
      ).storefrontTheme;
      expect(themeAgain).toEqual(theme);
    });

    it('rejects saving a template the current plan does not cover', async () => {
      const { accessToken, organizationId, slug } = await setupStorefrontOrg(
        'storefront-theme-reject@korva.test',
        'Theme Reject Org',
      );

      const res = await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ storefrontTemplate: 'salon' })
        .expect(403);
      expect(asError(res.body).code).toBe('STOREFRONT_TEMPLATE_NOT_IN_PLAN');

      // The rejected PATCH must not have partially applied — still "essentiel" publicly.
      const stillDefault = await request(server)
        .get(`/api/v1/public/${slug}`)
        .expect(200);
      expect(
        asSuccess<PublicOrganizationPayload>(stillDefault.body).storefrontTheme
          .template,
      ).toBe('essentiel');
    });

    it('clamps an explicitly saved template back down after a downgrade, without erroring', async () => {
      const { accessToken, organizationId, slug } = await setupStorefrontOrg(
        'storefront-theme-clamp@korva.test',
        'Theme Clamp Org',
      );

      await request(server)
        .post('/api/v1/subscriptions/change-plan')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ planKey: 'business' })
        .expect(201);

      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ storefrontTemplate: 'salon', storefrontPalette: 'corail' })
        .expect(200);

      const onBusiness = await request(server)
        .get(`/api/v1/public/${slug}`)
        .expect(200);
      expect(
        asSuccess<PublicOrganizationPayload>(onBusiness.body).storefrontTheme,
      ).toMatchObject({ template: 'salon', palette: 'corail' });

      await request(server)
        .post('/api/v1/subscriptions/change-plan')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ planKey: 'free' })
        .expect(201);

      const onFree = await request(server)
        .get(`/api/v1/public/${slug}`)
        .expect(200);
      expect(
        asSuccess<PublicOrganizationPayload>(onFree.body).storefrontTheme
          .template,
      ).toBe('essentiel');
    });
  });

  describe('storefront content sections (testimonials/team/gallery/about)', () => {
    it('is undefined on a free-plan organization by default', async () => {
      const { slug } = await setupStorefrontOrg(
        'content-sections-default@korva.test',
        'Content Default Org',
      );

      const res = await request(server)
        .get(`/api/v1/public/${slug}`)
        .expect(200);
      const info = asSuccess<PublicOrganizationPayload>(res.body);
      expect(info.aboutText).toBeUndefined();
      expect(info.testimonials).toBeUndefined();
      expect(info.teamMembers).toBeUndefined();
      expect(info.galleryImages).toBeUndefined();
      expect(info.faqItems).toBeUndefined();
    });

    it('rejects saving content sections below the Pro plan', async () => {
      const { accessToken, organizationId } = await setupStorefrontOrg(
        'content-sections-reject@korva.test',
        'Content Reject Org',
      );
      await request(server)
        .post('/api/v1/subscriptions/change-plan')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ planKey: 'starter' })
        .expect(201);

      const res = await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ aboutText: 'Notre histoire' })
        .expect(403);
      expect(asError(res.body).code).toBe(
        'STOREFRONT_CONTENT_SECTIONS_NOT_IN_PLAN',
      );
    });

    it('saves and publicly exposes content sections on a Pro plan, then clamps them after a downgrade', async () => {
      const { accessToken, organizationId, slug } = await setupStorefrontOrg(
        'content-sections-clamp@korva.test',
        'Content Clamp Org',
      );
      await request(server)
        .post('/api/v1/subscriptions/change-plan')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ planKey: 'pro' })
        .expect(201);

      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          aboutText: 'Notre histoire',
          testimonials: [
            { id: 't1', authorName: 'Ada Lovelace', quote: 'Excellent !' },
          ],
          teamMembers: [{ id: 'm1', name: 'Grace Hopper', role: 'Fondatrice' }],
          galleryImages: [{ id: 'g1', url: 'https://cdn.korva.test/1.jpg' }],
          faqItems: [
            { id: 'f1', question: 'Livrez-vous partout ?', answer: 'Oui.' },
          ],
        })
        .expect(200);

      const onPro = await request(server)
        .get(`/api/v1/public/${slug}`)
        .expect(200);
      const infoOnPro = asSuccess<PublicOrganizationPayload>(onPro.body);
      expect(infoOnPro.aboutText).toBe('Notre histoire');
      expect(infoOnPro.testimonials).toHaveLength(1);
      expect(infoOnPro.teamMembers).toHaveLength(1);
      expect(infoOnPro.galleryImages).toHaveLength(1);
      expect(infoOnPro.faqItems).toHaveLength(1);

      await request(server)
        .post('/api/v1/subscriptions/change-plan')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ planKey: 'free' })
        .expect(201);

      const onFree = await request(server)
        .get(`/api/v1/public/${slug}`)
        .expect(200);
      const infoOnFree = asSuccess<PublicOrganizationPayload>(onFree.body);
      expect(infoOnFree.aboutText).toBeUndefined();
      expect(infoOnFree.testimonials).toBeUndefined();
      expect(infoOnFree.teamMembers).toBeUndefined();
      expect(infoOnFree.galleryImages).toBeUndefined();
      expect(infoOnFree.faqItems).toBeUndefined();
    });
  });

  describe('storefront section visibility', () => {
    it('defaults to every section enabledModules allows when nothing is configured', async () => {
      const { slug } = await setupStorefrontOrg(
        'storefront-sections-default@korva.test',
        'Sections Default Org',
      );

      const res = await request(server)
        .get(`/api/v1/public/${slug}`)
        .expect(200);
      const info = asSuccess<PublicOrganizationPayload>(res.body);
      expect(info.visibleSections.sort()).toEqual(['booking', 'catalog']);
    });

    it('hides a section via storefrontSections even though its module stays enabled', async () => {
      const { accessToken, organizationId, slug } = await setupStorefrontOrg(
        'storefront-sections-hide@korva.test',
        'Sections Hide Org',
      );

      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ storefrontSections: ['catalog'] })
        .expect(200);

      const res = await request(server)
        .get(`/api/v1/public/${slug}`)
        .expect(200);
      const info = asSuccess<PublicOrganizationPayload>(res.body);
      expect(info.visibleSections).toEqual(['catalog']);
      // The booking module itself is untouched — only its public visibility changed.
      expect(info.enabledModules).toContain('booking');
    });

    it('never shows a section storefrontSections names but enabledModules does not allow', async () => {
      const { accessToken, organizationId, slug } = await setupStorefrontOrg(
        'storefront-sections-module-off@korva.test',
        'Sections Module Off Org',
        ['catalog', 'crm', 'website'],
      );

      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ storefrontSections: ['catalog', 'booking'] })
        .expect(200);

      const res = await request(server)
        .get(`/api/v1/public/${slug}`)
        .expect(200);
      const info = asSuccess<PublicOrganizationPayload>(res.body);
      expect(info.visibleSections).toEqual(['catalog']);
    });
  });

  describe('order tracking', () => {
    let slug: string;
    let activeOfferId: string;
    let orderNumber: string;
    const customerEmail = 'track-me@customer.test';

    beforeAll(async () => {
      const {
        accessToken,
        organizationId,
        slug: orgSlug,
      } = await setupStorefrontOrg(
        'storefront-order-tracking@korva.test',
        'Order Tracking Org',
      );
      slug = orgSlug;

      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'product',
          name: 'Tracked Mug',
          status: 'active',
          pricing: { amount: 15, currency: 'EUR' },
        })
        .expect(201);
      activeOfferId = asSuccess<OfferPayload>(offerRes.body).id;

      const orderRes = await request(server)
        .post(`/api/v1/public/${slug}/orders`)
        .send({
          items: [{ offerId: activeOfferId, quantity: 2 }],
          currency: 'EUR',
          contact: { email: customerEmail, firstName: 'Track' },
        })
        .expect(201);
      orderNumber = asSuccess<PublicOrderPayload>(orderRes.body).number;
    });

    it('returns the real order when the order number and email both match', async () => {
      const res = await request(server)
        .get(
          `/api/v1/public/${slug}/orders/${orderNumber}?email=${encodeURIComponent(customerEmail)}`,
        )
        .expect(200);
      const order = asSuccess<TrackedOrderPayload>(res.body);
      expect(order.number).toBe(orderNumber);
      expect(order.status).toBe('pending');
      expect(order.total).toBe(30);
      expect(order.currency).toBe('EUR');
      expect(order.items).toEqual([
        { description: 'Tracked Mug', quantity: 2, unitPrice: 15 },
      ]);
    });

    it('returns a generic 404 for a real order number with the wrong email (never distinguished from "not found")', async () => {
      const res = await request(server)
        .get(
          `/api/v1/public/${slug}/orders/${orderNumber}?email=${encodeURIComponent('attacker@evil.test')}`,
        )
        .expect(404);
      expect(asError(res.body).code).toBe('ORDER_NOT_FOUND');
    });

    it('returns the same generic 404 for an order number that does not exist at all', async () => {
      const res = await request(server)
        .get(
          `/api/v1/public/${slug}/orders/CMD-DOES-NOT-EXIST?email=${encodeURIComponent(customerEmail)}`,
        )
        .expect(404);
      expect(asError(res.body).code).toBe('ORDER_NOT_FOUND');
    });

    it('returns the same generic 404 when the real order number is looked up under a different organization (cross-tenant)', async () => {
      const { slug: otherSlug } = await setupStorefrontOrg(
        'storefront-order-tracking-other@korva.test',
        'Order Tracking Other Org',
      );

      const res = await request(server)
        .get(
          `/api/v1/public/${otherSlug}/orders/${orderNumber}?email=${encodeURIComponent(customerEmail)}`,
        )
        .expect(404);
      expect(asError(res.body).code).toBe('ORDER_NOT_FOUND');
    });

    it('rejects a lookup with no email query param as a validation error, not a 404', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slug}/orders/${orderNumber}`)
        .expect(400);
      expect(asError(res.body).code).toBe('VALIDATION_ERROR');
    });
  });

  describe('booking flow via the storefront', () => {
    let accessToken: string;
    let organizationId: string;
    let slug: string;
    let resourceId: string;
    let offerId: string;
    const monday = nextMonday();

    beforeAll(async () => {
      ({ accessToken, organizationId, slug } = await setupStorefrontOrg(
        'storefront-booking@korva.test',
        'Storefront Booking Org',
      ));

      const resourceRes = await request(server)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Studio',
          type: 'room',
          weeklyAvailability: [
            { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
          ],
        })
        .expect(201);
      resourceId = asSuccess<ResourcePayload>(resourceRes.body).id;

      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'booking',
          name: 'Yoga Class',
          status: 'active',
          pricing: { amount: 20, currency: 'EUR' },
        })
        .expect(201);
      offerId = asSuccess<OfferPayload>(offerRes.body).id;
    });

    it('lists active resources publicly', async () => {
      const res = await request(server)
        .get(`/api/v1/public/${slug}/resources`)
        .expect(200);
      const resources = asSuccess<{ id: string; name: string }[]>(res.body);
      expect(resources).toHaveLength(1);
      expect(resources[0]!.name).toBe('Studio');
    });

    it('shows availability publicly', async () => {
      const res = await request(server)
        .get(
          `/api/v1/public/${slug}/availability?resourceId=${resourceId}&date=${monday}`,
        )
        .expect(200);
      const availability = asSuccess<{ windows: unknown[] }>(res.body);
      expect(availability.windows).toEqual([
        { startTime: '09:00', endTime: '18:00' },
      ]);
    });

    it('creates a public booking, resolving the contact by email', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slug}/bookings`)
        .send({
          resourceId,
          offerId,
          startAt: `${monday}T10:00:00.000Z`,
          endAt: `${monday}T11:00:00.000Z`,
          contact: { email: 'yogi@customer.test', firstName: 'Yogi' },
        })
        .expect(201);
      const booking = asSuccess<PublicBookingPayload>(res.body);
      expect(booking.status).toBe('confirmed');
    });
  });

  describe('booking tracking', () => {
    let slug: string;
    let resourceId: string;
    let offerId: string;
    let bookingId: string;
    const monday = nextMonday();
    const customerEmail = 'track-booking@customer.test';

    beforeAll(async () => {
      const {
        accessToken,
        organizationId,
        slug: orgSlug,
      } = await setupStorefrontOrg(
        'storefront-booking-tracking@korva.test',
        'Booking Tracking Org',
      );
      slug = orgSlug;

      const resourceRes = await request(server)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Tracked Studio',
          type: 'room',
          weeklyAvailability: [
            { dayOfWeek: 1, startTime: '09:00', endTime: '18:00' },
          ],
        })
        .expect(201);
      resourceId = asSuccess<ResourcePayload>(resourceRes.body).id;

      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'booking',
          name: 'Tracked Yoga Class',
          status: 'active',
          pricing: { amount: 20, currency: 'EUR' },
        })
        .expect(201);
      offerId = asSuccess<OfferPayload>(offerRes.body).id;

      const bookingRes = await request(server)
        .post(`/api/v1/public/${slug}/bookings`)
        .send({
          resourceId,
          offerId,
          startAt: `${monday}T12:00:00.000Z`,
          endAt: `${monday}T13:00:00.000Z`,
          contact: { email: customerEmail, firstName: 'Tracked' },
        })
        .expect(201);
      bookingId = asSuccess<PublicBookingPayload>(bookingRes.body).id;
    });

    it('returns the real booking when the booking id and email both match', async () => {
      const res = await request(server)
        .get(
          `/api/v1/public/${slug}/bookings/${bookingId}?email=${encodeURIComponent(customerEmail)}`,
        )
        .expect(200);
      const booking = asSuccess<TrackedBookingPayload>(res.body);
      expect(booking.id).toBe(bookingId);
      expect(booking.status).toBe('confirmed');
    });

    it('returns a generic 404 for a real booking id with the wrong email', async () => {
      const res = await request(server)
        .get(
          `/api/v1/public/${slug}/bookings/${bookingId}?email=${encodeURIComponent('attacker@evil.test')}`,
        )
        .expect(404);
      expect(asError(res.body).code).toBe('BOOKING_NOT_FOUND');
    });

    it('returns the same generic 404 for a well-formed but non-existent booking id', async () => {
      const res = await request(server)
        .get(
          `/api/v1/public/${slug}/bookings/000000000000000000000000?email=${encodeURIComponent(customerEmail)}`,
        )
        .expect(404);
      expect(asError(res.body).code).toBe('BOOKING_NOT_FOUND');
    });

    it('returns the same generic 404 when the real booking id is looked up under a different organization (cross-tenant)', async () => {
      const { slug: otherSlug } = await setupStorefrontOrg(
        'storefront-booking-tracking-other@korva.test',
        'Booking Tracking Other Org',
      );

      const res = await request(server)
        .get(
          `/api/v1/public/${otherSlug}/bookings/${bookingId}?email=${encodeURIComponent(customerEmail)}`,
        )
        .expect(404);
      expect(asError(res.body).code).toBe('BOOKING_NOT_FOUND');
    });
  });

  describe('booking creation throttle (LOT P3-FIX)', () => {
    let slugA: string;
    let resourceIdA: string;
    let offerIdA: string;
    let slugB: string;
    let resourceIdB: string;
    let offerIdB: string;
    const monday = nextMonday();

    async function setupThrottleOrg(email: string, orgName: string) {
      const { accessToken, organizationId, slug } = await setupStorefrontOrg(
        email,
        orgName,
      );
      const resourceRes = await request(server)
        .post('/api/v1/resources')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          name: 'Throttle Room',
          type: 'room',
          // A wide window so a burst of test requests can each target a genuinely free hour —
          // a 400 SLOT_UNAVAILABLE (capacity, default 1) must never be mistaken for the 429
          // this suite is actually proving.
          weeklyAvailability: [
            { dayOfWeek: 1, startTime: '00:00', endTime: '23:00' },
          ],
        })
        .expect(201);
      const offerRes = await request(server)
        .post('/api/v1/offers')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({
          type: 'booking',
          name: 'Throttle Session',
          status: 'active',
          pricing: { amount: 10, currency: 'EUR' },
        })
        .expect(201);
      return {
        slug,
        resourceId: asSuccess<ResourcePayload>(resourceRes.body).id,
        offerId: asSuccess<OfferPayload>(offerRes.body).id,
      };
    }

    beforeAll(async () => {
      ({
        slug: slugA,
        resourceId: resourceIdA,
        offerId: offerIdA,
      } = await setupThrottleOrg(
        'storefront-throttle-a@korva.test',
        'Storefront Throttle Org A',
      ));
      ({
        slug: slugB,
        resourceId: resourceIdB,
        offerId: offerIdB,
      } = await setupThrottleOrg(
        'storefront-throttle-b@korva.test',
        'Storefront Throttle Org B',
      ));
    });

    function bookingPayload(resourceId: string, offerId: string, hour: number) {
      const startHour = String(hour).padStart(2, '0');
      const endHour = String(hour + 1).padStart(2, '0');
      return {
        resourceId,
        offerId,
        startAt: `${monday}T${startHour}:00:00.000Z`,
        endAt: `${monday}T${endHour}:00:00.000Z`,
        contact: {
          email: `throttle-${hour}@customer.test`,
          firstName: 'Throttle',
        },
      };
    }

    // Test 1 — normal, low-volume use stays well under the dedicated limit and works normally.
    it('allows a normal, low-volume sequence of booking attempts', async () => {
      const first = await request(server)
        .post(`/api/v1/public/${slugA}/bookings`)
        .send(bookingPayload(resourceIdA, offerIdA, 1));
      const second = await request(server)
        .post(`/api/v1/public/${slugA}/bookings`)
        .send(bookingPayload(resourceIdA, offerIdA, 2));

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
    });

    // Test 2 — a rapid burst on the same route/IP eventually gets 429, proving the dedicated
    // throttle (stricter than the 120/min global) actually engages before too many confirmed
    // bookings can be created in quick succession.
    it('throttles a rapid burst of booking attempts with 429 once the dedicated limit is exceeded', async () => {
      const statuses: number[] = [];
      for (let hour = 3; hour < 20 && !statuses.includes(429); hour++) {
        const res = await request(server)
          .post(`/api/v1/public/${slugA}/bookings`)
          .send(bookingPayload(resourceIdA, offerIdA, hour));
        statuses.push(res.status);
      }

      expect(statuses).toContain(429);
      // The burst didn't start pre-throttled — some earlier requests genuinely succeeded first.
      expect(statuses.some((status) => status === 201)).toBe(true);
    }, 20000);

    // Test 3 — scope: a public GET route is entirely unaffected by the booking route's throttle,
    // even while that IP is currently throttled on POST bookings (per the burst test above).
    it('leaves other public routes unaffected by the booking throttle', async () => {
      await request(server).get(`/api/v1/public/${slugA}/offers`).expect(200);
    });

    // Test 4 — the throttle is a pure anti-abuse mechanism keyed on (route, IP), not a stand-in
    // for tenant isolation: this IP being throttled on org A's booking route also throttles a
    // booking POST for org B, a completely different organization/tenant.
    it('is not tenant-scoped: the same throttled IP is also blocked when booking for a different organization', async () => {
      const res = await request(server)
        .post(`/api/v1/public/${slugB}/bookings`)
        .send(bookingPayload(resourceIdB, offerIdB, 1));

      expect(res.status).toBe(429);
    });
  });

  describe('lead capture (embeddable widget, docs/BUSINESS_OS_AUDIT.md roadmap item #8)', () => {
    it('creates a Contact, a Lead in a lazily-created default pipeline, and a Note carrying the message', async () => {
      const { slug, accessToken, organizationId } = await setupStorefrontOrg(
        'widget-owner@korva.test',
        'Widget Org',
      );

      const res = await request(server)
        .post(`/api/v1/public/${slug}/leads`)
        .send({
          message: "Bonjour, j'aimerais un devis pour un événement.",
          contact: {
            email: 'visitor@customer.test',
            firstName: 'Visiteur',
            phone: '+33600000000',
          },
        })
        .expect(201);
      const lead = asSuccess<{ id: string; status: string }>(res.body);
      expect(lead.status).toBe('open');

      const pipelinesRes = await request(server)
        .get('/api/v1/pipelines')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const pipelines = asSuccess<
        { id: string; name: string; isDefault: boolean }[]
      >(pipelinesRes.body);
      expect(pipelines).toHaveLength(1);
      expect(pipelines[0]).toMatchObject({ name: 'Ventes', isDefault: true });

      const leadsRes = await request(server)
        .get('/api/v1/leads')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const leads = asSuccess<
        { id: string; source?: string; pipelineId: string }[]
      >(leadsRes.body);
      expect(leads.map((l) => l.id)).toContain(lead.id);
      const createdLead = leads.find((l) => l.id === lead.id)!;
      expect(createdLead.source).toBe('website_widget');
      expect(createdLead.pipelineId).toBe(pipelines[0]!.id);

      const contactsRes = await request(server)
        .get('/api/v1/contacts?search=visitor@customer.test')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      const contacts = asSuccess<{ id: string; firstName?: string }[]>(
        contactsRes.body,
      );
      expect(contacts.some((c) => c.firstName === 'Visiteur')).toBe(true);
    });

    it("reuses the second lead's request on the same visitor's existing Contact instead of creating a duplicate, and reuses the same default pipeline", async () => {
      const { slug, accessToken, organizationId } = await setupStorefrontOrg(
        'widget-repeat-owner@korva.test',
        'Widget Repeat Org',
      );

      await request(server)
        .post(`/api/v1/public/${slug}/leads`)
        .send({
          message: 'Première demande',
          contact: { email: 'repeat-visitor@customer.test' },
        })
        .expect(201);
      await request(server)
        .post(`/api/v1/public/${slug}/leads`)
        .send({
          message: 'Deuxième demande',
          contact: { email: 'repeat-visitor@customer.test' },
        })
        .expect(201);

      const contactsRes = await request(server)
        .get('/api/v1/contacts?search=repeat-visitor@customer.test')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<{ id: string }[]>(contactsRes.body)).toHaveLength(1);

      const pipelinesRes = await request(server)
        .get('/api/v1/pipelines')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .expect(200);
      expect(asSuccess<{ id: string }[]>(pipelinesRes.body)).toHaveLength(1);
    });

    it('accepts a custom source and rejects a request missing the required message', async () => {
      const { slug } = await setupStorefrontOrg(
        'widget-source-owner@korva.test',
        'Widget Source Org',
      );

      const customSourceRes = await request(server)
        .post(`/api/v1/public/${slug}/leads`)
        .send({
          message: 'Demande depuis mon propre site',
          source: 'my_existing_website',
          contact: { email: 'custom-source@customer.test' },
        })
        .expect(201);
      expect(asSuccess<{ id: string }>(customSourceRes.body).id).toBeTruthy();

      const missingMessageRes = await request(server)
        .post(`/api/v1/public/${slug}/leads`)
        .send({ contact: { email: 'no-message@customer.test' } })
        .expect(400);
      expect(asError(missingMessageRes.body).code).toBe('VALIDATION_ERROR');
    });

    it('404s with MODULE_NOT_AVAILABLE when the organization has not enabled crm', async () => {
      const { slug } = await setupStorefrontOrg(
        'widget-no-crm-owner@korva.test',
        'Widget No CRM Org',
        ['catalog'],
      );

      const res = await request(server)
        .post(`/api/v1/public/${slug}/leads`)
        .send({
          message: 'Bonjour',
          contact: { email: 'x@customer.test' },
        })
        .expect(404);
      expect(asError(res.body).code).toBe('MODULE_NOT_AVAILABLE');
    });

    // Permissive CORS on this path (so the embeddable widget works from any external site) is
    // set by publicCorsMiddleware, which main.ts registers directly on the Express app inside
    // bootstrap() — this file's app is built via Test.createTestingModule(...).compile() +
    // createNestApplication(), which never runs main.ts/bootstrap() at all (same as every other
    // e2e file in this repo: none of them exercise app.enableCors() either). See
    // public-cors.middleware.spec.ts for a direct unit test of that middleware's behavior
    // instead.
  });

  describe('module gating and unknown organizations', () => {
    it('rejects a public request for a module the organization has not enabled', async () => {
      const { slug } = await setupStorefrontOrg(
        'storefront-no-commerce@korva.test',
        'No Commerce Org',
        ['catalog'],
      );

      const res = await request(server)
        .post(`/api/v1/public/${slug}/orders`)
        .send({
          items: [{ offerId: '000000000000000000000000', quantity: 1 }],
          currency: 'EUR',
          contact: { email: 'x@customer.test' },
        })
        .expect(404);
      expect(asError(res.body).code).toBe('MODULE_NOT_AVAILABLE');
    });

    it('404s for an unknown organization slug', async () => {
      const res = await request(server)
        .get('/api/v1/public/does-not-exist/offers')
        .expect(404);
      expect(asError(res.body).code).toBe('ORGANIZATION_NOT_FOUND');
    });

    it('404s with MODULE_NOT_AVAILABLE for the storefront page itself when "website" is not enabled', async () => {
      const { slug } = await setupStorefrontOrg(
        'no-website-owner@korva.test',
        'No Website Org',
        ['catalog'],
      );

      const res = await request(server)
        .get(`/api/v1/public/${slug}`)
        .expect(404);
      expect(asError(res.body).code).toBe('MODULE_NOT_AVAILABLE');
    });

    it('the "website" module gates only the storefront page — sibling catalog/booking/commerce/leads routes stay reachable regardless', async () => {
      const { accessToken, organizationId, slug } = await setupStorefrontOrg(
        'website-off-catalog-on@korva.test',
        'Website Off Catalog On Org',
        ['catalog', 'crm'],
      );

      // The storefront page itself is blocked...
      const pageRes = await request(server)
        .get(`/api/v1/public/${slug}`)
        .expect(404);
      expect(asError(pageRes.body).code).toBe('MODULE_NOT_AVAILABLE');

      // ...but a route gated on its own module (catalog) works exactly as if "website" were
      // never introduced — this is what keeps the embeddable widget usable on a business's own
      // external site even when they don't want KORVA's own hosted page.
      await request(server).get(`/api/v1/public/${slug}/offers`).expect(200);

      // Enabling "website" makes the page itself reachable too, with no effect on the routes
      // that were already independently working.
      await request(server)
        .patch('/api/v1/organizations/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .set('X-Organization-Id', organizationId)
        .send({ enabledModules: ['catalog', 'crm', 'website'] })
        .expect(200);

      await request(server).get(`/api/v1/public/${slug}`).expect(200);
      await request(server).get(`/api/v1/public/${slug}/offers`).expect(200);
    });
  });
});

/** Returns an ISO date string (YYYY-MM-DD) for the next Monday, at least 7 days out. */
function nextMonday(): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 7);
  while (date.getUTCDay() !== 1) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}
