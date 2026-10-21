import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  createPublicBookingSchema,
  domainAllowedQuerySchema,
  createPublicLeadSchema,
  createPublicOrderSchema,
  listPublicOffersQuerySchema,
  publicAvailabilityQuerySchema,
  publicSlotsQuerySchema,
  publicStayQuoteSchema,
  publicTableSlotsSchema,
  publicOfferReviewsQuerySchema,
  resolveDomainQuerySchema,
  searchPublicOffersQuerySchema,
  trackByEmailQuerySchema,
  trackCartCheckoutStartedSchema,
  type CreatePublicBookingInput,
  type CreatePublicLeadInput,
  type CreatePublicOrderInput,
  type DomainAllowedQuery,
  type ListPublicOffersQuery,
  type PublicAvailabilityQuery,
  type PublicSlotsQuery,
  type PublicStayQuoteQuery,
  type PublicTableSlotsQuery,
  type PublicOfferReviewsQuery,
  type ResolveDomainQuery,
  type SearchPublicOffersQuery,
  type TrackByEmailQuery,
  type TrackCartCheckoutStartedInput,
} from '@korva/validation';
import { PublicService } from './public.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { Public } from '../common/decorators/public.decorator';

/**
 * Tighter than the global 120/min and AUTH_THROTTLE's 30/min: a single unauthenticated POST here
 * creates a *confirmed* booking that occupies real, often capacity-1 availability — unlike a
 * login attempt, each hit here can directly deny a slot to a genuine customer. A real visitor
 * books at most a handful of slots in one sitting, so 5/min leaves normal use untouched while
 * making a rapid calendar-flooding burst meaningfully slower from a single source. This is an
 * anti-abuse throttle, not a defense against a distributed/botnet attacker spreading requests
 * across many IPs — see docs/PRODUCTION_READINESS.md for that broader, separately-scoped gap.
 *
 * Reused (not redefined) on the GET order/booking tracking lookups below for the same reason:
 * each request there tests one guessed order number/booking id + email combination, so this is
 * exactly the kind of low-volume-for-a-real-customer, high-value-for-an-enumeration-attempt
 * route this limit was designed for.
 */
const PUBLIC_BOOKING_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

/**
 * Phase E4 (docs/KORVA_OS_V2_AUDIT.md §2.6) — a distinct, non-parameterized route namespace
 * (not `public/:organizationSlug/...`) so this org-agnostic "list every tenant slug" endpoint
 * can never collide with `PublicController`'s per-slug routes below, regardless of controller
 * registration order.
 */
@ApiTags('public')
@Public()
@Controller('public-sites')
export class PublicSitesController {
  constructor(private readonly publicService: PublicService) {}

  /** Backs apps/storefront's sitemap.ts — the only "list organizations" surface this API
   *  exposes, deliberately thin (slug + updatedAt), scoped to `website`-enabled orgs only. */
  @Get('sitemap-entries')
  listSitemapEntries() {
    return this.publicService.listSitemapEntries();
  }

  /** Phase E3 — backs apps/storefront's middleware.ts, called on every request whose `Host`
   *  header doesn't match the platform's own shared storefront domain. Registered before
   *  `sitemap-entries` above isn't required (both are literal, non-overlapping segments) — see
   *  PublicService#resolveDomain for the `website`-module gate. */
  @Get('resolve-domain')
  async resolveDomain(
    @Query(new ZodValidationPipe(resolveDomainQuerySchema))
    query: ResolveDomainQuery,
  ) {
    const resolved = await this.publicService.resolveDomain(query.host);
    if (!resolved) {
      throw new NotFoundException({
        code: 'CUSTOM_DOMAIN_NOT_FOUND',
        message: 'No organization is connected to this domain',
      });
    }
    return resolved;
  }

  /**
   * Authorizes TLS certificate issuance for a tenant's custom domain — the `ask` endpoint for
   * Caddy's on-demand TLS (see docker/caddy/Caddyfile). Without it, a reverse proxy fronting
   * arbitrary tenant hostnames would either need every domain listed in its config at boot
   * (impossible: tenants add domains at runtime) or would issue a certificate for any hostname
   * pointed at it, which is an open invitation to exhaust Let's Encrypt rate limits.
   *
   * Returns 204 for a domain genuinely connected to a website-enabled organization and 404
   * otherwise. Deliberately returns NO body: Caddy only reads the status code, and this route is
   * unauthenticated, so revealing which organization owns a domain would leak more than the
   * caller needs. It is the same question `resolve-domain` above answers — the separate route
   * exists only because Caddy's query parameter is `domain`, not `host`. Full path, which the
   * Caddyfile hardcodes: `/api/v1/public-sites/domain-allowed`.
   */
  @Get('domain-allowed')
  @HttpCode(204)
  async domainAllowed(
    @Query(new ZodValidationPipe(domainAllowedQuerySchema))
    query: DomainAllowedQuery,
  ): Promise<void> {
    const resolved = await this.publicService.resolveDomain(query.domain);
    if (!resolved) {
      throw new NotFoundException({
        code: 'CUSTOM_DOMAIN_NOT_FOUND',
        message: 'No organization is connected to this domain',
      });
    }
  }
}

@ApiTags('public')
@Public()
@Controller('public/:organizationSlug')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get()
  getOrganization(@Param('organizationSlug') slug: string) {
    return this.publicService.getOrganization(slug);
  }

  @Get('offers')
  listOffers(
    @Param('organizationSlug') slug: string,
    @Query(new ZodValidationPipe(listPublicOffersQuerySchema))
    query: ListPublicOffersQuery,
  ) {
    return this.publicService.listOffers(slug, query);
  }

  /**
   * Registered before `offers/:offerId` below — Express/Nest match routes in declaration order,
   * so a literal `offers/search` segment must come first or it would be swallowed as an
   * `:offerId` value of "search" (same reasoning applies to `offers/categories`).
   */
  @Get('offers/search')
  searchOffers(
    @Param('organizationSlug') slug: string,
    @Query(new ZodValidationPipe(searchPublicOffersQuerySchema))
    query: SearchPublicOffersQuery,
  ) {
    return this.publicService.searchOffers(slug, query);
  }

  @Get('offers/categories')
  listOfferCategories(@Param('organizationSlug') slug: string) {
    return this.publicService.listOfferCategories(slug);
  }

  @Get('offers/:offerId')
  getOffer(
    @Param('organizationSlug') slug: string,
    @Param('offerId') offerId: string,
  ) {
    return this.publicService.getOffer(slug, offerId);
  }

  @Get('offers/:offerId/reviews')
  getOfferReviews(
    @Param('organizationSlug') slug: string,
    @Param('offerId') offerId: string,
    @Query(new ZodValidationPipe(publicOfferReviewsQuerySchema))
    query: PublicOfferReviewsQuery,
  ) {
    return this.publicService.getOfferReviews(
      slug,
      offerId,
      query.page,
      query.limit,
    );
  }

  @Get('resources')
  listResources(@Param('organizationSlug') slug: string) {
    return this.publicService.listResources(slug);
  }

  @Get('availability')
  getAvailability(
    @Param('organizationSlug') slug: string,
    @Query(new ZodValidationPipe(publicAvailabilityQuerySchema))
    query: PublicAvailabilityQuery,
  ) {
    return this.publicService.getAvailability(
      slug,
      query.resourceId,
      query.date,
    );
  }

  @Get('table-slots')
  getTableSlots(
    @Param('organizationSlug') slug: string,
    @Query(new ZodValidationPipe(publicTableSlotsSchema))
    query: PublicTableSlotsQuery,
  ) {
    return this.publicService.getTableSlots(slug, query);
  }

  @Get('stay-quote')
  getStayQuote(
    @Param('organizationSlug') slug: string,
    @Query(new ZodValidationPipe(publicStayQuoteSchema))
    query: PublicStayQuoteQuery,
  ) {
    return this.publicService.getStayQuote(slug, query);
  }

  @Get('slots')
  getSlots(
    @Param('organizationSlug') slug: string,
    @Query(new ZodValidationPipe(publicSlotsQuerySchema))
    query: PublicSlotsQuery,
  ) {
    return this.publicService.getSlots(slug, query);
  }

  @Throttle(PUBLIC_BOOKING_THROTTLE)
  @Post('bookings')
  createBooking(
    @Param('organizationSlug') slug: string,
    @Body(new ZodValidationPipe(createPublicBookingSchema))
    body: CreatePublicBookingInput,
  ) {
    return this.publicService.createBooking(slug, body);
  }

  @Post('orders')
  createOrder(
    @Param('organizationSlug') slug: string,
    @Body(new ZodValidationPipe(createPublicOrderSchema))
    body: CreatePublicOrderInput,
  ) {
    return this.publicService.createOrder(slug, body);
  }

  /** Fire-and-forget hook from the storefront's checkout form — see
   *  PublicService#trackCheckoutStarted for the full rationale. */
  @Post('cart-checkout-started')
  trackCheckoutStarted(
    @Param('organizationSlug') slug: string,
    @Body(new ZodValidationPipe(trackCartCheckoutStartedSchema))
    body: TrackCartCheckoutStartedInput,
  ) {
    return this.publicService.trackCheckoutStarted(slug, body);
  }

  /** Backs the embeddable widget's lead-capture form — see PublicService#createLead. */
  @Post('leads')
  createLead(
    @Param('organizationSlug') slug: string,
    @Body(new ZodValidationPipe(createPublicLeadSchema))
    body: CreatePublicLeadInput,
  ) {
    return this.publicService.createLead(slug, body);
  }

  /**
   * Customer order tracking — never authenticated, so `email` (query, validated below) is the
   * only accepted proof of ownership; the order number in the path is never sufficient on its
   * own. See PublicService#trackOrder for the generic-404 requirement this enforces.
   */
  @Throttle(PUBLIC_BOOKING_THROTTLE)
  @Get('orders/:orderNumber')
  trackOrder(
    @Param('organizationSlug') slug: string,
    @Param('orderNumber') orderNumber: string,
    @Query(new ZodValidationPipe(trackByEmailQuerySchema))
    query: TrackByEmailQuery,
  ) {
    return this.publicService.trackOrder(slug, orderNumber, query.email);
  }

  /** Same email-as-sole-authorization model as trackOrder above. */
  @Throttle(PUBLIC_BOOKING_THROTTLE)
  @Get('bookings/:bookingId')
  trackBooking(
    @Param('organizationSlug') slug: string,
    @Param('bookingId') bookingId: string,
    @Query(new ZodValidationPipe(trackByEmailQuerySchema))
    query: TrackByEmailQuery,
  ) {
    return this.publicService.trackBooking(slug, bookingId, query.email);
  }

  /**
   * Initiates a real online payment for an order just placed via POST .../orders — same
   * email-as-sole-authorization model as trackOrder, and the same enumeration-risk throttle
   * (this also triggers one real, billable call to the organization's connected PSP, which is
   * its own reason to keep this rate-limited). See PublicService#initiateOnlinePayment.
   */
  @Throttle(PUBLIC_BOOKING_THROTTLE)
  @Post('orders/:orderId/pay')
  initiateOnlinePayment(
    @Param('organizationSlug') slug: string,
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(trackByEmailQuerySchema))
    body: TrackByEmailQuery,
  ) {
    return this.publicService.initiateOnlinePayment(slug, orderId, body.email);
  }
}
