import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { BusinessAlertsService } from '../business-alerts/business-alerts.service';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BUSINESS_MODEL_DEFINITIONS,
  CUSTOM_DOMAIN_MIN_PLAN,
  DEFAULT_CHECK_IN_TIME,
  DEFAULT_CHECK_OUT_TIME,
  STOREFRONT_SECTIONS,
  verticalForOrganizationType,
  getStorefrontTemplate,
  selectableFontPairings,
  selectablePalettes,
  onlinePaymentTermsAccepted,
  planHasFeature,
  pickDeterministic,
  planMeetsMinimum,
  type KorvaModule,
  type PaymentMethod,
  type StorefrontSection,
  type StorefrontTheme,
} from '@korva/types';
import type {
  CreatePublicBookingInput,
  PublicSlotsQuery,
  PublicStayQuoteQuery,
  PublicTableSlotsQuery,
  CreatePublicLeadInput,
  CreatePublicOrderInput,
  ListPublicOffersQuery,
  SearchPublicOffersQuery,
  TrackCartCheckoutStartedInput,
  SubmitInvitedReviewInput,
} from '@korva/validation';
import type { OfferDocument } from '../catalog/offers/schemas/offer.schema';
import { OrganizationsService } from '../organizations/organizations.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { OffersService } from '../catalog/offers/offers.service';
import { ReviewsService, reviewAuthorName } from '../reviews/reviews.service';
import { ReviewRequestsService } from '../reviews/review-requests.service';
import type { ReviewInvitationClaims } from '../reviews/review-invitation-token';
import {
  AvailabilityService,
  nightsBetween,
  zonedTimeToUtc,
} from '../booking/availability/availability.service';
import { BookingsService } from '../booking/bookings/bookings.service';
import { ResourcesService } from '../booking/resources/resources.service';
import { OrdersService } from '../commerce/orders/orders.service';
import { CartsService } from '../commerce/carts/carts.service';
import { InvoicesService } from '../finance/invoices/invoices.service';
import { PaymentsService } from '../finance/payments/payments.service';
import { PaymentProviderResolverService } from '../finance/payments/providers/payment-provider-resolver.service';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from '../communication/providers/email-provider.interface';
import { interpolate } from '../shared/template';
import { resolveStorefrontFulfillment } from './storefront-fulfillment';
import { resolveChosenOptions } from '../catalog/offers/offer-options';
import { ContactsService } from '../crm/contacts/contacts.service';
import { LeadsService } from '../crm/leads/leads.service';
import { NotesService } from '../crm/notes/notes.service';
import { OrganizationDocument } from '../organizations/schemas/organization.schema';
import { Order, OrderDocument } from '../commerce/orders/schemas/order.schema';
import {
  Booking,
  BookingDocument,
} from '../booking/bookings/schemas/booking.schema';
import {
  Contact,
  ContactDocument,
} from '../crm/contacts/schemas/contact.schema';
import { orgLocale, translator } from '../shared/i18n';

/** Slot length offered for an offer with no duration of its own when the visitor has not picked
 *  one — the booking form's own default before durations moved onto the offer. */
const DEFAULT_SLOT_DURATION_MINUTES = 60;

/**
 * Same generic 404 for every reason a lookup can fail: unknown order/booking number, an
 * order/booking that belongs to a different organization, and a genuine order/booking whose
 * contact email doesn't match. Deliberately identical in shape and status code in all three
 * cases — distinguishing "wrong email" from "doesn't exist" would let an attacker enumerate
 * valid order/booking numbers by observing which guesses get a different error.
 */
function trackingNotFound(entity: 'order' | 'booking'): NotFoundException {
  return new NotFoundException({
    code: entity === 'order' ? 'ORDER_NOT_FOUND' : 'BOOKING_NOT_FOUND',
    message: `${entity === 'order' ? 'Order' : 'Booking'} not found`,
  });
}

/** Contact.email is stored lowercased/trimmed already; normalize the caller-supplied side too. */
function emailsMatch(storedEmail: string, candidateEmail: string): boolean {
  return storedEmail === candidateEmail.trim().toLowerCase();
}

// In the business's language (shared/i18n.ts): its customers read it.
const ORDER_CONFIRMATION_BODY_TEMPLATE = {
  fr: `<p>Bonjour {{firstName}},</p>
<p>Votre commande <strong>{{orderNumber}}</strong> d'un montant de {{total}} {{currency}} a bien été enregistrée.</p>
<p>Vous pouvez suivre son statut à tout moment depuis la page de suivi de commande de la boutique.</p>`,
  en: `<p>Hello {{firstName}},</p>
<p>Your order <strong>{{orderNumber}}</strong> for {{total}} {{currency}} has been recorded.</p>
<p>You can follow its status at any time from the shop's order tracking page.</p>`,
};

/**
 * Backs the public, unauthenticated storefront API (`/public/:organizationSlug/...`). Never
 * exposes internal fields (customFields, SKUs, blocked-slot reasons, ...) and never accepts
 * a price/total from the client — offers are always re-fetched server-side. See
 * docs/multi-tenancy.md: organizationId here comes from the slug, not a TenantContext, so
 * every method must resolve and re-check it itself rather than trusting a caller-supplied id.
 */
/** Offer pages listed per site in the sitemap (a sitemap file holds 50 000 URLs). */
const SITEMAP_OFFER_LIMIT = 500;

@Injectable()
export class PublicService {
  private readonly logger = new Logger(PublicService.name);

  constructor(
    private readonly businessAlerts: BusinessAlertsService,
    private readonly organizationsService: OrganizationsService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly offersService: OffersService,
    private readonly availabilityService: AvailabilityService,
    private readonly bookingsService: BookingsService,
    private readonly resourcesService: ResourcesService,
    private readonly ordersService: OrdersService,
    private readonly invoicesService: InvoicesService,
    private readonly paymentsService: PaymentsService,
    private readonly paymentProviderResolver: PaymentProviderResolverService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    private readonly contactsService: ContactsService,
    private readonly leadsService: LeadsService,
    private readonly notesService: NotesService,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    private readonly reviewsService: ReviewsService,
    private readonly cartsService: CartsService,
    private readonly reviewRequestsService: ReviewRequestsService,
  ) {}

  private async resolveOrganization(
    slug: string,
  ): Promise<OrganizationDocument> {
    return this.organizationsService.getBySlug(slug);
  }

  private assertModuleEnabled(
    organization: OrganizationDocument,
    module: KorvaModule,
  ): void {
    // A suspended organization's site answers exactly like a site switched off: the storefront
    // shows its "pas encore en ligne" page, and nothing can be ordered or booked.
    if (
      organization.suspendedAt ||
      !organization.enabledModules.includes(module)
    ) {
      throw new NotFoundException({
        code: 'MODULE_NOT_AVAILABLE',
        message: `This organization has not enabled "${module}"`,
      });
    }
  }

  /**
   * Phase E3 — backs PublicSitesController's `GET /public-sites/resolve-domain` and, through the
   * same call, Caddy's on-demand-TLS `ask` at `GET /public-sites/domain-allowed`. Resolves only
   * when the organization owns this exact custom domain, has `website` enabled, AND is on a plan
   * that includes a custom domain.
   *
   * The `website` gate is the product-activation one: a custom domain must obey the same rule as
   * the shared `{STOREFRONT_URL}/{slug}` URL (see getOrganization's own
   * `assertModuleEnabled(organization, 'website')`), otherwise disabling Website would leave a
   * stale custom domain still serving the storefront.
   *
   * THE PLAN GATE WAS MISSING UNTIL 2026-10-14, and its absence was a monetization hole of
   * exactly the kind assertOverridesWithinPlan exists to close. `assertCustomDomainAllowed`
   * runs in OrganizationsService.update — at SAVE time only. Nothing re-read it and nothing
   * clamped `customDomain` on a downgrade, so one month of Starter bought a custom domain
   * permanently: the domain kept resolving, Caddy kept renewing its certificate, and the free
   * plan kept a Starter feature. This is the same read-time clamp resolveStorefrontTheme and
   * computeVisibleSections already apply for the same reason, and it degrades rather than
   * erases — the stored `customDomain` is untouched, the organization's storefront stays
   * reachable at `{STOREFRONT_URL}/{slug}`, and re-subscribing restores the domain with no
   * data lost.
   */
  async resolveDomain(hostname: string): Promise<{ slug: string } | null> {
    const organization =
      await this.organizationsService.getByCustomDomain(hostname);
    if (!organization || !organization.enabledModules.includes('website')) {
      return null;
    }
    const plan = await this.subscriptionsService.getActivePlan(
      organization.id as string,
    );
    if (!planMeetsMinimum(plan.key, CUSTOM_DOMAIN_MIN_PLAN)) {
      return null;
    }
    return { slug: organization.slug };
  }

  /** Backs PublicSitesController's `GET /public-sites/sitemap-entries` — see its own doc comment. */
  async listSitemapEntries() {
    const entries = await this.organizationsService.listWebsiteSitemapEntries();
    // Each site's offer pages too: they are what people search for ("tresses africaines
    // Cocody"). Active offers only, from sites whose catalogue is on; capped per site.
    const withCatalog = entries.filter((entry) =>
      entry.enabledModules.includes('catalog'),
    );
    const offers = withCatalog.length
      ? await this.contactModel.db
          .collection('offers')
          .find(
            {
              organizationId: { $in: withCatalog.map((entry) => entry._id) },
              status: 'active',
            },
            { projection: { organizationId: 1, updatedAt: 1 } },
          )
          .sort({ updatedAt: -1 })
          .limit(SITEMAP_OFFER_LIMIT * Math.max(1, withCatalog.length))
          .toArray()
      : [];
    return entries.map((entry) => {
      const own = offers
        .filter((offer) => String(offer.organizationId) === String(entry._id))
        .slice(0, SITEMAP_OFFER_LIMIT);
      return {
        slug: entry.slug,
        updatedAt: entry.updatedAt,
        catalog: entry.enabledModules.includes('catalog'),
        offers: own.map((offer) => ({
          id: String(offer._id),
          updatedAt: offer.updatedAt as Date,
        })),
      };
    });
  }

  async getOrganization(slug: string) {
    const organization = await this.resolveOrganization(slug);
    // Only this method is gated on 'website' — every other public route (catalog/booking/
    // commerce/leads) is independently gated on its own module and stays reachable regardless,
    // since those also power the embeddable widget on a business's own external site, a
    // distinct capability from KORVA's own hosted storefront page.
    this.assertModuleEnabled(organization, 'website');
    const [plan, reviewSummary] = await Promise.all([
      this.subscriptionsService.getActivePlan(organization.id as string),
      this.reviewsService.getPublicOrganizationSummary(
        organization.id as string,
      ),
    ]);
    // Defense-in-depth, same reasoning as resolveStorefrontTheme's own plan clamp below: an
    // organization downgraded after saving testimonials/team/gallery/about/FAQ must stop showing
    // them on the public page even though the fields are still stored — enforced at save-time
    // by EntitlementsService.assertContentSectionsAllowed, re-checked here at read-time.
    const contentSectionsAllowed = planMeetsMinimum(plan.key, 'pro');
    return {
      name: organization.name,
      slug: organization.slug,
      type: organization.type,
      businessModel: organization.businessModel,
      currency: organization.currency,
      language: organization.language,
      logo: organization.logo,
      brandColor: organization.brandColor,
      tagline: organization.tagline,
      heroImage: organization.heroImage,
      // Contact details are never plan-gated: a free shop must at least be reachable. `|| undefined`
      // because the dashboard clears a value by saving "".
      contactPhone: organization.contactPhone || undefined,
      whatsappNumber: organization.whatsappNumber || undefined,
      contactAddress: organization.contactAddress || undefined,
      enabledModules: organization.enabledModules,
      visibleSections: this.computeVisibleSections(organization),
      shippingFlatRate: organization.shippingFlatRate,
      fulfillmentModes: organization.fulfillmentModes,
      deliveryZones: organization.deliveryZones,
      pickupInstructions: organization.pickupInstructions,
      orderLeadTimeMinutes: organization.orderLeadTimeMinutes,
      storefrontTheme: this.resolveStorefrontTheme(organization, plan.key),
      // Free storefronts carry the KORVA mention; paid ones do not.
      poweredByKorva: !planHasFeature(plan.key, 'no_korva_branding'),
      // Whether a visitor can CREATE a customer account (CustomerAuthService.register checks
      // the same thing); signing in to an existing one is never taken away.
      customerAccountsEnabled: planHasFeature(plan.key, 'customer_accounts'),
      // Whether "Se connecter" leads anywhere: accounts can be created, or some exist from a
      // former paid plan. A Free site with neither offered a sign-in page with no way in.
      customerSignInAvailable:
        planHasFeature(plan.key, 'customer_accounts') ||
        (await this.contactModel.db
          .collection('customer_accounts')
          .countDocuments({ organizationId: organization._id }, { limit: 1 })) >
          0,
      acceptedPaymentMethods:
        await this.resolveAvailablePaymentMethods(organization),
      // Unlike the content sections below, SEO overrides are never plan-gated — basic SEO
      // control isn't a premium feature.
      seoTitle: organization.seoTitle,
      seoDescription: organization.seoDescription,
      aboutText: contentSectionsAllowed ? organization.aboutText : undefined,
      testimonials: contentSectionsAllowed
        ? organization.testimonials
        : undefined,
      teamMembers: contentSectionsAllowed
        ? organization.teamMembers
        : undefined,
      galleryImages: contentSectionsAllowed
        ? organization.galleryImages
        : undefined,
      faqItems: contentSectionsAllowed ? organization.faqItems : undefined,
      // Real customers' reviews are never plan-gated, unlike the curated testimonials above.
      reviewSummary,
    };
  }

  /**
   * `organization.acceptedPaymentMethods` alone isn't enough to decide whether the storefront
   * can actually offer "online" as a checkout option — it also needs a real PSP to resolve for
   * this organization's market (see PaymentProviderResolverService), or there is nothing to
   * actually charge the payer through. Falls back to `["cash"]` if filtering out an
   * unavailable "online" would otherwise leave the storefront with no payment method at all.
   */
  private async resolveAvailablePaymentMethods(
    organization: OrganizationDocument,
  ): Promise<PaymentMethod[]> {
    const configured = organization.acceptedPaymentMethods ?? ['cash'];
    if (!configured.includes('online')) {
      return configured;
    }
    // Saved before the terms existed (or the terms changed since): no online payment until the
    // business accepts them again in its Settings.
    const onlineAvailable =
      onlinePaymentTermsAccepted(organization.onlinePaymentTerms) &&
      (await this.isOnlinePaymentAvailable(
        organization.id as string,
        organization.currency,
      ));
    if (onlineAvailable) {
      return configured;
    }
    const withoutOnline = configured.filter((m) => m !== 'online');
    return withoutOnline.length > 0 ? withoutOnline : ['cash'];
  }

  private async isOnlinePaymentAvailable(
    organizationId: string,
    currency: string,
  ): Promise<boolean> {
    // A paid-plan feature (PLAN_FEATURE_MIN_PLAN.online_payment): a free organization's
    // storefront offers cash only, and initiateOnlinePayment — which goes through here — is
    // refused, even if "online" was saved while it was on a paid plan.
    const plan = await this.subscriptionsService.getActivePlan(organizationId);
    if (!planHasFeature(plan.key, 'online_payment')) return false;
    try {
      const provider = await this.paymentProviderResolver.resolve({
        flow: 'commerce',
        organizationId,
      });
      // GeniusPay charges XOF, EUR and USD: a shop selling in MAD or CAD would send its customers
      // to a checkout that refuses them — it keeps cash/on-delivery instead.
      return (
        !provider.supportedCurrencies ||
        provider.supportedCurrencies.includes(currency.toUpperCase())
      );
    } catch {
      return false;
    }
  }

  /**
   * Resolves the organization's storefront visual template/palette/font-pairing, clamped to
   * what its current plan actually allows — see @korva/types storefront-themes.ts and
   * EntitlementsService.assertStorefrontThemeAllowed (which enforces the same rules at
   * save-time; this is defense-in-depth for an organization downgraded after saving a choice a
   * lower plan no longer allows). Palette/font-pairing default to a deterministic pick derived
   * from the organization id when unset, so two same-vertical organizations that never touched
   * these settings still render differently from each other.
   */
  private resolveStorefrontTheme(
    organization: OrganizationDocument,
    planKey: string,
  ): StorefrontTheme {
    const vertical = verticalForOrganizationType(organization.type);
    // Owner's explicit choice, then the trade's own template, then the type of activity's — the
    // last one covers an owner whose trade was "Autre" or whose free-text `type` was edited, who
    // used to fall all the way back to the generic "essentiel" page.
    const requestedKey =
      organization.storefrontTemplate ??
      vertical?.defaultStorefrontTemplate ??
      (organization.businessModel
        ? BUSINESS_MODEL_DEFINITIONS[organization.businessModel]
            .defaultStorefrontTemplate
        : undefined) ??
      'essentiel';
    let templateDef = getStorefrontTemplate(requestedKey);
    if (!planMeetsMinimum(planKey, templateDef.minPlan)) {
      templateDef = getStorefrontTemplate('essentiel');
    }

    if (templateDef.key === 'essentiel') {
      return {
        template: 'essentiel',
        fontPairing: 'sobre',
        customAccentApplied: !!organization.brandColor,
      };
    }

    const canRefine = planMeetsMinimum(
      planKey,
      templateDef.refinedChoiceMinPlan,
    );
    const allowedPalettes = canRefine
      ? templateDef.palettes
      : templateDef.palettes.slice(0, 1);
    const allowedFontPairings = canRefine
      ? templateDef.fontPairings
      : templateDef.fontPairings.slice(0, 1);

    const seed = organization.id as string;
    // A saved choice is honoured if the plan still allows it, premium ones included; the default
    // is drawn from the template's own list only, so premium never appears by itself.
    const palette =
      organization.storefrontPalette &&
      selectablePalettes(templateDef, planKey).includes(
        organization.storefrontPalette,
      )
        ? organization.storefrontPalette
        : pickDeterministic(seed, allowedPalettes);
    const fontPairing =
      organization.storefrontFontPairing &&
      selectableFontPairings(templateDef, planKey).includes(
        organization.storefrontFontPairing,
      )
        ? organization.storefrontFontPairing
        : pickDeterministic(`${seed}:font`, allowedFontPairings);

    return {
      template: templateDef.key,
      palette,
      fontPairing,
      customAccentApplied:
        !!organization.brandColor &&
        planMeetsMinimum(planKey, templateDef.customAccentMinPlan),
    };
  }

  /**
   * A section only ever shows when BOTH its module is enabled AND (if the org configured
   * `storefrontSections` at all) it's included there — an org can only use this to hide a
   * section it could otherwise show, never to show one its `enabledModules` doesn't allow.
   * Returned (not the raw `storefrontSections`) so apps/storefront never has to re-derive this
   * intersection itself.
   */
  private computeVisibleSections(
    organization: OrganizationDocument,
  ): StorefrontSection[] {
    const configured = organization.storefrontSections;
    return STOREFRONT_SECTIONS.filter(
      (section) =>
        organization.enabledModules.includes(section) &&
        (!configured || configured.includes(section)),
    );
  }

  private toPublicOffer(offer: OfferDocument) {
    return {
      id: offer.id as string,
      type: offer.type,
      name: offer.name,
      description: offer.description,
      images: offer.images,
      categories: offer.categories,
      pricing: offer.pricing,
      variants: offer.variants,
      durationMinutes: offer.durationMinutes ?? undefined,
      compareAtPrice: offer.compareAtPrice ?? undefined,
      attributes: offer.attributes,
      optionGroups: offer.optionGroups,
      bookingUnit: offer.bookingUnit ?? 'slot',
      minNights: offer.minNights ?? undefined,
    };
  }

  /** Small, unpaginated preview — backs the homepage templates and generateMetadata. Capped at
   *  50 for backward compatibility with those existing callers; a catalog larger than that is
   *  only ever fully reachable through searchOffers()/the dedicated catalogue page below. */
  async listOffers(slug: string, query: ListPublicOffersQuery) {
    const organization = await this.resolveOrganization(slug);
    this.assertModuleEnabled(organization, 'catalog');

    const { data } = await this.offersService.list(organization.id as string, {
      page: 1,
      limit: 50,
      sort: 'newest',
      status: 'active',
      type: query.type,
    });
    return data.map((offer) => this.toPublicOffer(offer));
  }

  /** Real pagination/search/sort/category-filter over the FULL active catalog — backs the
   *  dedicated `/[slug]/catalogue` page, unlike listOffers()'s fixed 50-item preview above. */
  async searchOffers(slug: string, query: SearchPublicOffersQuery) {
    const organization = await this.resolveOrganization(slug);
    this.assertModuleEnabled(organization, 'catalog');

    const { data, pagination } = await this.offersService.list(
      organization.id as string,
      {
        page: query.page,
        limit: query.limit,
        status: 'active',
        type: query.type,
        category: query.category,
        search: query.search,
        sort: query.sort,
      },
    );
    return {
      data: data.map((offer) => this.toPublicOffer(offer)),
      pagination,
    };
  }

  async listOfferCategories(slug: string): Promise<string[]> {
    const organization = await this.resolveOrganization(slug);
    this.assertModuleEnabled(organization, 'catalog');
    return this.offersService.distinctActiveCategories(
      organization.id as string,
    );
  }

  /** Single-offer lookup — never distinguishes "doesn't exist" from "exists but isn't active"
   *  (draft/archived), same generic-404 principle as trackingNotFound() above: an offer id a
   *  visitor could only have guessed or scraped from a stale link must never confirm its own
   *  existence once it's no longer for sale. */
  async getOffer(slug: string, offerId: string) {
    const organization = await this.resolveOrganization(slug);
    this.assertModuleEnabled(organization, 'catalog');
    return this.toPublicOffer(
      await this.findActiveOffer(organization.id as string, offerId),
    );
  }

  private async findActiveOffer(
    organizationId: string,
    offerId: string,
  ): Promise<OfferDocument> {
    let offer: OfferDocument;
    try {
      offer = await this.offersService.getById(organizationId, offerId);
    } catch {
      throw new NotFoundException({
        code: 'OFFER_NOT_FOUND',
        message: 'Offer not found',
      });
    }
    if (offer.status !== 'active') {
      throw new NotFoundException({
        code: 'OFFER_NOT_FOUND',
        message: 'Offer not found',
      });
    }
    return offer;
  }

  /** Reuses getOffer's own existence/active/module checks so a review summary can never leak
   *  whether an inactive or nonexistent offer id has ever received reviews. */
  async getOfferReviews(
    slug: string,
    offerId: string,
    page: number,
    limit: number,
  ) {
    const organization = await this.resolveOrganization(slug);
    await this.getOffer(slug, offerId);
    return this.reviewsService.getPublicSummary(
      organization.id as string,
      offerId,
      page,
      limit,
    );
  }

  /**
   * What a review link (sent after a delivered order / completed booking — see
   * ReviewRequestsService) is about. Every failure — forged, expired, another business's link,
   * an order that no longer exists — is the same 404, so the link reveals nothing it shouldn't.
   */
  async getReviewInvitation(slug: string, token: string) {
    const { organization, claims, items } = await this.resolveInvitation(
      slug,
      token,
    );
    const contact = await this.contactModel
      .findOne(
        {
          _id: new Types.ObjectId(claims.contactId),
          organizationId: organization._id,
        },
        { firstName: 1 },
      )
      .lean()
      .exec();
    return {
      organizationName: organization.name,
      entity: claims.entity,
      items: items.names,
      customerFirstName: contact?.firstName || undefined,
      alreadyReviewed: await this.reviewsService.hasReviewed(
        claims.organizationId,
        claims.contactId,
        claims.entity,
        claims.entityId,
      ),
    };
  }

  async submitInvitedReview(slug: string, input: SubmitInvitedReviewInput) {
    const { claims, items } = await this.resolveInvitation(slug, input.token);
    let authorName: string | undefined;
    if (input.showName) {
      const contact = await this.contactModel
        .findById(claims.contactId, { firstName: 1, lastName: 1 })
        .lean()
        .exec();
      authorName = contact ? reviewAuthorName(contact) : undefined;
    }
    const review = await this.reviewsService.create(
      claims.organizationId,
      claims.contactId,
      {
        entity: claims.entity,
        entityId: claims.entityId,
        rating: input.rating,
        comment: input.comment,
      },
      { offerId: items.singleOfferId, authorName },
    );
    return {
      rating: review.rating,
      createdAt: review.get('createdAt') as Date,
    };
  }

  private async resolveInvitation(slug: string, token: string) {
    const invalid = () =>
      new NotFoundException({
        code: 'REVIEW_INVITATION_INVALID',
        message: 'This review link is invalid or has expired',
      });
    const organization = await this.resolveOrganization(slug);
    const claims = this.reviewRequestsService.verify(token);
    if (
      !claims ||
      claims.organizationId !== (organization.id as string) ||
      organization.suspendedAt
    ) {
      throw invalid();
    }
    const items = await this.invitationItems(claims);
    if (!items) throw invalid();
    return { organization, claims, items };
  }

  /** The reviewed order's or booking's offers — null when it is gone, belongs to someone else,
   *  or is not finished (a link is only ever issued once it is, but nothing else re-checks). */
  private async invitationItems(
    claims: ReviewInvitationClaims,
  ): Promise<{ names: string[]; singleOfferId?: string } | null> {
    const scope = {
      _id: new Types.ObjectId(claims.entityId),
      organizationId: new Types.ObjectId(claims.organizationId),
      contactId: new Types.ObjectId(claims.contactId),
    };
    if (claims.entity === 'order') {
      const order = await this.orderModel
        .findOne(scope, { items: 1, status: 1 })
        .lean()
        .exec();
      if (!order || order.status !== 'fulfilled') return null;
      const offerIds = new Set(
        order.items
          .map((item) => item.offerId?.toString())
          .filter((id): id is string => Boolean(id)),
      );
      return {
        names: [...new Set(order.items.map((item) => item.description))],
        singleOfferId: offerIds.size === 1 ? [...offerIds][0] : undefined,
      };
    }
    const booking = await this.bookingModel
      .findOne(scope, { offerId: 1, status: 1 })
      .lean()
      .exec();
    if (!booking || booking.status !== 'completed') return null;
    const offer = await this.offersService
      .getById(claims.organizationId, booking.offerId.toString())
      .catch(() => null);
    return {
      names: offer ? [offer.name] : [],
      singleOfferId: booking.offerId.toString(),
    };
  }

  async listResources(slug: string) {
    const organization = await this.resolveOrganization(slug);
    this.assertModuleEnabled(organization, 'booking');

    // A business that switched booking on but set up nobody yet must still be bookable.
    await this.resourcesService.ensureDefaultResource(
      organization.id as string,
      organization.name,
      organization.businessModel,
    );
    const resources = await this.resourcesService.list(
      organization.id as string,
      true,
    );
    return resources.map((resource) => ({
      id: resource.id as string,
      name: resource.name,
      type: resource.type,
      capacity: resource.capacity,
      weeklyAvailability: resource.weeklyAvailability,
      description: resource.description,
      photo: resource.photo,
      seats: resource.seats,
    }));
  }

  async getAvailability(slug: string, resourceId: string, date: string) {
    const organization = await this.resolveOrganization(slug);
    this.assertModuleEnabled(organization, 'booking');

    const availability = await this.availabilityService.getDayAvailability(
      organization.id as string,
      resourceId,
      date,
    );
    return {
      date: availability.date,
      windows: availability.windows,
      bookings: availability.bookings.map((b) => ({
        startAt: b.startAt,
        endAt: b.endAt,
      })),
      blockedSlots: availability.blockedSlots.map((b) => ({
        startAt: b.startAt,
        endAt: b.endAt,
      })),
    };
  }

  /**
   * Bookable start times for one offer on one resource and day — see
   * AvailabilityService#getDaySlots. The offer's own duration wins over the one in the query.
   */
  async getSlots(slug: string, query: PublicSlotsQuery) {
    const organization = await this.resolveOrganization(slug);
    this.assertModuleEnabled(organization, 'booking');
    const organizationId = organization.id as string;
    const offer = await this.findActiveOffer(organizationId, query.offerId);
    const durationMinutes =
      offer.durationMinutes ??
      query.durationMinutes ??
      DEFAULT_SLOT_DURATION_MINUTES;

    return {
      date: query.date,
      durationMinutes,
      slots: await this.availabilityService.getDaySlots(
        organizationId,
        query.resourceId,
        query.date,
        durationMinutes,
        undefined,
        offer.bufferMinutes ?? 0,
      ),
    };
  }

  /**
   * The instants a public booking occupies, decided by the API from the offer:
   *  - a STAY (per-night offer) from its checkIn/checkOut dates, at the organization's check-in
   *    and check-out times in its timezone — never browser-built instants;
   *  - a SLOT from startAt, with a fixed-length offer's end replaced by start + duration (a
   *    45-minute service can never be booked for 15).
   */
  private resolveBookingTimes(
    organization: OrganizationDocument,
    offer: OfferDocument,
    input: Pick<
      CreatePublicBookingInput,
      'startAt' | 'endAt' | 'checkIn' | 'checkOut'
    >,
  ): { startAt: string; endAt: string } {
    if (offer.bookingUnit === 'night') {
      if (!input.checkIn || !input.checkOut) {
        throw new BadRequestException({
          code: 'STAY_DATES_REQUIRED',
          message: 'Choose an arrival and a departure date',
        });
      }
      return {
        startAt: zonedTimeToUtc(
          input.checkIn,
          organization.checkInTime ?? DEFAULT_CHECK_IN_TIME,
          organization.timezone,
        ).toISOString(),
        endAt: zonedTimeToUtc(
          input.checkOut,
          organization.checkOutTime ?? DEFAULT_CHECK_OUT_TIME,
          organization.timezone,
        ).toISOString(),
      };
    }
    if (!input.startAt || !input.endAt) {
      throw new BadRequestException({
        code: 'SLOT_REQUIRED',
        message: 'Choose a time slot',
      });
    }
    return {
      startAt: input.startAt,
      endAt: offer.durationMinutes
        ? new Date(
            new Date(input.startAt).getTime() + offer.durationMinutes * 60_000,
          ).toISOString()
        : input.endAt,
    };
  }

  /**
   * What a stay would cost and whether the room is free, before the customer commits: the same
   * rules as the booking itself (BookingsService/AvailabilityService), run without writing.
   */
  async getStayQuote(slug: string, query: PublicStayQuoteQuery) {
    const organization = await this.resolveOrganization(slug);
    this.assertModuleEnabled(organization, 'booking');
    const organizationId = organization.id as string;
    const offer = await this.findActiveOffer(organizationId, query.offerId);
    if (offer.bookingUnit !== 'night') {
      throw new BadRequestException({
        code: 'NOT_A_STAY_OFFER',
        message: 'This offer is not booked by the night',
      });
    }
    const { startAt, endAt } = this.resolveBookingTimes(
      organization,
      offer,
      query,
    );
    const nights = nightsBetween(
      new Date(startAt),
      new Date(endAt),
      organization.timezone,
    );
    const base = {
      nights,
      pricePerNight: offer.pricing.amount,
      total: Math.max(nights, 0) * offer.pricing.amount,
      currency: offer.pricing.currency,
      minNights: offer.minNights ?? null,
    };
    if (nights < 1)
      return { ...base, available: false, reason: 'STAY_TOO_SHORT' };
    if (offer.minNights && nights < offer.minNights) {
      return { ...base, available: false, reason: 'STAY_BELOW_MINIMUM' };
    }
    try {
      await this.availabilityService.assertSlotAvailable(
        organizationId,
        query.resourceId,
        new Date(startAt),
        new Date(endAt),
        undefined,
        undefined,
        { stay: true },
      );
      return { ...base, available: true, reason: null };
    } catch (error) {
      const code =
        (error as { getResponse?: () => { code?: string } }).getResponse?.()
          ?.code ?? 'UNAVAILABLE';
      return { ...base, available: false, reason: code };
    }
  }

  /** Active tables seating at least `partySize`, smallest first (a resource with `seats`). */
  private async tablesFor(organizationId: string, partySize: number) {
    const resources = await this.resourcesService.list(organizationId, true);
    return resources
      .filter(
        (resource) => resource.seats != null && resource.seats >= partySize,
      )
      .sort((a, b) => (a.seats ?? 0) - (b.seats ?? 0));
  }

  /**
   * Start times on `date` when at least one table seats the party — the union of each fitting
   * table's slots (AvailabilityService#getDaySlots), so the customer never chooses a table.
   */
  async getTableSlots(slug: string, query: PublicTableSlotsQuery) {
    const organization = await this.resolveOrganization(slug);
    this.assertModuleEnabled(organization, 'booking');
    const organizationId = organization.id as string;
    const offer = await this.findActiveOffer(organizationId, query.offerId);
    const durationMinutes =
      offer.durationMinutes ?? DEFAULT_SLOT_DURATION_MINUTES;
    const byStart = new Map<
      string,
      { startAt: string; endAt: string; time: string }
    >();
    for (const table of await this.tablesFor(organizationId, query.partySize)) {
      const slots = await this.availabilityService.getDaySlots(
        organizationId,
        table.id as string,
        query.date,
        durationMinutes,
        undefined,
        offer.bufferMinutes ?? 0,
      );
      for (const slot of slots) byStart.set(slot.startAt, slot);
    }
    return {
      date: query.date,
      durationMinutes,
      slots: [...byStart.values()].sort((a, b) =>
        a.startAt.localeCompare(b.startAt),
      ),
    };
  }

  /**
   * Books the smallest free table that seats the party — big tables stay free for big groups.
   * Each attempt goes through BookingsService.create, so the resource lock and the capacity
   * check still serialise two customers racing for the last table: the loser simply moves to
   * the next one, and gets NO_TABLE_AVAILABLE when none is left.
   */
  private async bookAnyTable(
    organizationId: string,
    partySize: number,
    input: {
      offerId: string;
      startAt: string;
      endAt: string;
      contactId: string;
      notes?: string;
      partySize?: number;
    },
  ) {
    const unavailable = new Set([
      'SLOT_UNAVAILABLE',
      'SLOT_BLOCKED',
      'OUTSIDE_AVAILABILITY_WINDOW',
      'RESOURCE_INACTIVE',
    ]);
    for (const table of await this.tablesFor(organizationId, partySize)) {
      try {
        return await this.bookingsService.create(organizationId, undefined, {
          ...input,
          resourceId: table.id as string,
        });
      } catch (error) {
        const code = (
          error as { getResponse?: () => { code?: string } }
        ).getResponse?.()?.code;
        if (!code || !unavailable.has(code)) throw error;
      }
    }
    throw new BadRequestException({
      code: 'NO_TABLE_AVAILABLE',
      message: 'No table for this party size is free at that time',
    });
  }

  async createBooking(slug: string, input: CreatePublicBookingInput) {
    const organization = await this.resolveOrganization(slug);
    this.assertModuleEnabled(organization, 'booking');
    const organizationId = organization.id as string;
    const offer = await this.findActiveOffer(organizationId, input.offerId);
    const { startAt, endAt } = this.resolveBookingTimes(
      organization,
      offer,
      input,
    );

    const contact = await this.contactsService.findOrCreateByEmail(
      organizationId,
      input.contact,
    );
    const bookingInput = {
      offerId: input.offerId,
      startAt,
      endAt,
      contactId: contact.id as string,
      notes: input.notes,
      partySize: input.partySize,
    };
    const booking = input.resourceId
      ? await this.bookingsService.create(organizationId, undefined, {
          ...bookingInput,
          resourceId: input.resourceId,
        })
      : await this.bookAnyTable(
          organizationId,
          input.partySize ?? 0,
          bookingInput,
        );

    void this.businessAlerts.notify(organizationId, {
      kind: 'booking',
      offerName: offer.name,
      startAt: booking.startAt,
      customer: customerLabel(contact),
    });

    return {
      id: booking.id as string,
      status: booking.status,
      startAt: booking.startAt,
      endAt: booking.endAt,
    };
  }

  /**
   * Fired by the storefront's CheckoutPanel once an email becomes known (on the email field's
   * blur), before the real order exists — the only point at which an otherwise anonymous,
   * localStorage-only cart (apps/storefront/src/lib/use-cart.ts) becomes attributable to a real
   * contact. Fire-and-forget on the frontend; a failure here never blocks checkout. Powers
   * AbandonedCartReminderSchedulerService, which finds carts left untouched past a threshold
   * and sends a recovery message — see CartsService.syncItemsForContact/markConvertedForContact.
   */
  async trackCheckoutStarted(
    slug: string,
    input: TrackCartCheckoutStartedInput,
  ): Promise<{ tracked: true }> {
    const organization = await this.resolveOrganization(slug);
    this.assertModuleEnabled(organization, 'commerce');
    const organizationId = organization.id as string;

    const contact = await this.contactsService.findOrCreateByEmail(
      organizationId,
      input.contact,
    );
    await this.cartsService.syncItemsForContact(
      organizationId,
      contact.id as string,
      input.items,
    );
    return { tracked: true };
  }

  async createOrder(slug: string, input: CreatePublicOrderInput) {
    const organization = await this.resolveOrganization(slug);
    this.assertModuleEnabled(organization, 'commerce');
    const organizationId = organization.id as string;

    const contact = await this.contactsService.findOrCreateByEmail(
      organizationId,
      input.contact,
    );

    // Price/description are always re-resolved from the real Offer — never trusted from the public
    // client. Only an offer for sale can be ordered: a draft or archived one used to be orderable
    // by anyone who had its id.
    const offers = await Promise.all(
      input.items.map((item) =>
        this.findActiveOffer(organizationId, item.offerId),
      ),
    );
    const items = input.items.map((item, index) => {
      const offer = offers[index]!;
      // OfferVariant subdocuments always carry a Mongoose-assigned `_id` at runtime (the schema
      // declares `{ _id: true }`), just not as a field on the TS class itself — same runtime-only
      // access the schema's own toJSON transform already relies on (see offer.schema.ts).
      const variant = item.variantId
        ? offer.variants.find(
            (v) =>
              String((v as unknown as { _id: Types.ObjectId })._id) ===
              item.variantId,
          )
        : undefined;
      if (item.variantId && !variant) {
        throw new NotFoundException({
          code: 'VARIANT_NOT_FOUND',
          message: 'Variant not found for this offer',
        });
      }
      // Options are checked and priced from the stored offer (never from the client), and named
      // in the description, which is what the order, the invoice and the kitchen ticket show.
      const options = resolveChosenOptions(offer, item.optionIds);
      const baseName = variant ? `${offer.name} — ${variant.name}` : offer.name;
      return {
        offerId: item.offerId,
        variantId: item.variantId,
        description: options.labels.length
          ? `${baseName} (${options.labels.join(', ')})`
          : baseName,
        quantity: item.quantity,
        unitPrice:
          (variant?.priceOverride ?? offer.pricing.amount) + options.priceDelta,
        taxRate: offer.pricing.taxRate,
      };
    });

    const fulfillment = resolveStorefrontFulfillment(
      organization,
      input,
      items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
    );

    const order = await this.ordersService.createFromStorefront(
      organizationId,
      {
        contactId: contact.id as string,
        items,
        currency: input.currency,
        notes: input.notes,
        discountCode: input.discountCode,
        ...fulfillment,
      },
    );

    // Best-effort, same posture as PasswordResetService.forgotPassword's own email send — a
    // delivery failure must never fail order creation itself (the order is already real either
    // way), only ever logged. `contact.email` is required by input.contact's own validation
    // (publicContactSchema) so it's always set in practice; the guard is only to satisfy
    // Contact's own wider (optional) schema type.
    if (contact.email) {
      try {
        await this.emailProvider.send({
          to: contact.email,
          subject: translator(organization.language)(
            `Confirmation de commande ${order.number}`,
            `Order confirmation ${order.number}`,
          ),
          body: interpolate(
            ORDER_CONFIRMATION_BODY_TEMPLATE[orgLocale(organization.language)],
            {
              firstName: contact.firstName ?? '',
              orderNumber: order.number,
              total: order.total.toFixed(2),
              currency: order.currency,
            },
            { escapeHtml: true },
          ),
        });
      } catch (error) {
        this.logger.error(
          `Failed to send order confirmation email for order ${order.number}`,
          error,
        );
      }
    }

    // Best-effort — closes out any cart-abandonment episode tracked for this contact (see
    // trackCheckoutStarted below) now that a real order exists. Never fails order creation: the
    // order is already real either way, this is bookkeeping for a scheduler that hasn't run yet.
    try {
      await this.cartsService.markConvertedForContact(
        organizationId,
        contact.id as string,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to mark abandoned-cart tracking converted for order ${order.number}`,
        error,
      );
    }

    void this.businessAlerts.notify(organizationId, {
      kind: 'order',
      number: order.number,
      total: order.total,
      currency: order.currency,
      customer: customerLabel(contact),
    });

    return {
      id: order.id as string,
      number: order.number,
      total: order.total,
      currency: order.currency,
      status: order.status,
    };
  }

  /**
   * Initiates a real online payment for an order just placed via createOrder — never trusts a
   * client-supplied amount, always charges the invoice's own total. `email` is the sole
   * authorization check, same generic-404-on-mismatch model as trackOrder (a raw MongoDB
   * ObjectId `orderId`, unlike the short sequential order NUMBER trackOrder guards against, has
   * enough entropy that it isn't realistically guessable — but this still doesn't rely on that
   * alone). Confirms the order and generates its invoice on first call if needed (an order paid
   * online is, by definition, confirmed — there's no separate staff review step for it); a
   * second call for the same order reuses the same invoice/payment via
   * PaymentsService.create's own idempotency (keyed deterministically off `orderId`, since an
   * anonymous storefront customer has no `Idempotency-Key` header to send).
   */
  async initiateOnlinePayment(slug: string, orderId: string, email: string) {
    const organization = await this.resolveOrganization(slug);
    this.assertModuleEnabled(organization, 'commerce');
    const organizationId = organization.id as string;

    const acceptedMethods =
      await this.resolveAvailablePaymentMethods(organization);
    if (!acceptedMethods.includes('online')) {
      throw new BadRequestException({
        code: 'ONLINE_PAYMENT_NOT_AVAILABLE',
        message: 'This organization does not accept online payment.',
      });
    }

    let order;
    try {
      order = await this.orderModel
        .findOne({
          _id: new Types.ObjectId(orderId),
          organizationId: new Types.ObjectId(organizationId),
        })
        .exec();
    } catch {
      // Malformed orderId (not a valid ObjectId) — same generic 404 as "doesn't exist".
      throw trackingNotFound('order');
    }
    if (!order) {
      throw trackingNotFound('order');
    }
    const contact = await this.contactModel
      .findOne({ _id: order.contactId, organizationId: organization._id })
      .exec();
    if (!contact?.email || !emailsMatch(contact.email, email)) {
      throw trackingNotFound('order');
    }

    let provider;
    try {
      provider = await this.paymentProviderResolver.resolve({
        flow: 'commerce',
        organizationId,
      });
    } catch {
      throw new BadRequestException({
        code: 'ONLINE_PAYMENT_NOT_AVAILABLE',
        message: 'This organization does not accept online payment.',
      });
    }

    if (order.status === 'pending') {
      await this.ordersService.confirm(organizationId, undefined, orderId);
    } else if (order.status !== 'confirmed' && order.status !== 'fulfilled') {
      throw new BadRequestException({
        code: 'ORDER_NOT_PAYABLE',
        message: `Cannot pay for an order with status "${order.status}"`,
      });
    }

    let invoice = order.invoiceId
      ? await this.invoicesService.getById(
          organizationId,
          order.invoiceId.toString(),
        )
      : await this.ordersService.generateInvoice(
          organizationId,
          undefined,
          orderId,
        );
    // generateInvoice creates a DRAFT, and PaymentsService refuses to record a payment against a
    // draft (INVOICE_NOT_PAYABLE) — so no storefront customer could ever pay online. A customer
    // paying is the moment the invoice is due: issue it first.
    if (invoice.status === 'draft') {
      invoice = await this.invoicesService.issue(
        organizationId,
        undefined,
        invoice.id as string,
      );
    }

    if (invoice.status === 'paid') {
      throw new BadRequestException({
        code: 'ORDER_ALREADY_PAID',
        message: 'This order has already been paid.',
      });
    }

    const storefrontUrl = (
      process.env.STOREFRONT_URL ?? 'http://localhost:3001'
    ).replace(/\/$/, '');
    // Back from GeniusPay, the customer lands on THEIR order — number filled in, payment status
    // checked live (trackOrder) — never on an empty tracking form they have no number for.
    const redirectUrl = `${storefrontUrl}/${slug}/track?${new URLSearchParams({
      kind: 'order',
      number: order.number,
      email: contact.email,
      paid: '1',
    }).toString()}`;

    const payment = await this.paymentsService.create(
      organizationId,
      undefined,
      {
        invoiceId: invoice.id as string,
        amount: Math.round((invoice.total - invoice.amountPaid) * 100) / 100,
        method: 'online',
      },
      `public-order-payment:${orderId}`,
      { provider, customerEmail: contact.email, redirectUrl },
    );

    if (!payment.checkoutUrl) {
      throw new BadRequestException({
        code: 'ONLINE_PAYMENT_NOT_AVAILABLE',
        message: 'Unable to start an online payment for this order right now.',
      });
    }

    return { checkoutUrl: payment.checkoutUrl, orderNumber: order.number };
  }

  /**
   * Backs the embeddable widget (apps/storefront/public/korva-widget.js) — the "capturer des
   * leads" / "envoyer des demandes de contact" capability from the Business OS brief §9-11
   * (docs/BUSINESS_OS_AUDIT.md roadmap item #8). Creates (or reuses, by email) a Contact, a Lead
   * (qualification-only — pipeline/value tracking now lives on Deal, created later via
   * LeadsService.convertToDeal once a staff member qualifies this inquiry), and a Note carrying
   * the visitor's message, exactly mirroring how a staff member would capture the same inquiry
   * manually. `lead.created` is published for free by LeadsService.create, so this is
   * immediately visible to the Decision Engine/Workflow Engine like any other lead.
   */
  async createLead(slug: string, input: CreatePublicLeadInput) {
    const organization = await this.resolveOrganization(slug);
    this.assertModuleEnabled(organization, 'crm');
    const organizationId = organization.id as string;

    const contact = await this.contactsService.findOrCreateByEmail(
      organizationId,
      input.contact,
    );

    const lead = await this.leadsService.create(organizationId, undefined, {
      contactId: contact.id as string,
      source: input.source ?? 'website_widget',
      customFields: {},
    });

    await this.notesService.create(organizationId, undefined, {
      entity: 'lead',
      entityId: lead.id as string,
      content: input.message,
    });
    void this.businessAlerts.notify(organizationId, {
      kind: 'request',
      message: input.message,
      customer: customerLabel(contact),
    });

    return {
      id: lead.id as string,
      status: lead.status,
    };
  }

  /**
   * Customer-facing order lookup after the fact. `email` is the sole authorization check — it
   * must match the email of the Contact the order was placed under. An order number alone is
   * NOT sufficient (it's a small, sequential, human-readable identifier — trivially guessable/
   * enumerable), so every failure path (unknown number, number belonging to another
   * organization, correct number but wrong email) returns the exact same generic 404 via
   * trackingNotFound(); see that helper's doc for why they must never be distinguishable.
   */
  async trackOrder(slug: string, orderNumber: string, email: string) {
    const organization = await this.resolveOrganization(slug);
    this.assertModuleEnabled(organization, 'commerce');
    const organizationId = new Types.ObjectId(organization.id as string);

    const order = await this.orderModel
      .findOne({
        organizationId,
        number: orderNumber,
      })
      .exec();
    if (!order) {
      throw trackingNotFound('order');
    }

    const contact = await this.contactModel
      .findOne({ _id: order.contactId, organizationId })
      .exec();
    if (!contact?.email || !emailsMatch(contact.email, email)) {
      throw trackingNotFound('order');
    }

    // The order's online payment, checked with GeniusPay when still open: the customer is often
    // back on this page before GeniusPay's webhook has arrived.
    let payment = await this.paymentsService.findByIdempotencyKey(
      organization.id as string,
      `public-order-payment:${order.id as string}`,
    );
    if (
      payment &&
      (payment.status === 'pending' || payment.status === 'processing') &&
      payment.providerReference
    ) {
      payment = await this.paymentsService
        .reconcileProcessingPayment(
          organization.id as string,
          payment.id as string,
        )
        .catch(() => payment);
    }

    return {
      number: order.number,
      status: order.status,
      payment: payment
        ? {
            status:
              payment.status === 'completed' || payment.status === 'refunded'
                ? ('paid' as const)
                : payment.status === 'failed'
                  ? ('failed' as const)
                  : ('pending' as const),
          }
        : null,
      items: order.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        modifiers: item.modifiers,
      })),
      total: order.total,
      currency: order.currency,
    };
  }

  /** Same email-as-sole-authorization model as trackOrder — see that method's doc. */
  async trackBooking(slug: string, bookingId: string, email: string) {
    const organization = await this.resolveOrganization(slug);
    this.assertModuleEnabled(organization, 'booking');
    const organizationId = new Types.ObjectId(organization.id as string);

    if (!Types.ObjectId.isValid(bookingId)) {
      throw trackingNotFound('booking');
    }
    const booking = await this.bookingModel
      .findOne({
        _id: new Types.ObjectId(bookingId),
        organizationId,
      })
      .exec();
    if (!booking) {
      throw trackingNotFound('booking');
    }

    const contact = await this.contactModel
      .findOne({ _id: booking.contactId, organizationId })
      .exec();
    if (!contact?.email || !emailsMatch(contact.email, email)) {
      throw trackingNotFound('booking');
    }

    return {
      id: booking.id as string,
      status: booking.status,
      startAt: booking.startAt,
      endAt: booking.endAt,
      pricing: booking.pricing,
    };
  }
}

/** How an alert names the customer: first name and e-mail when known. */
function customerLabel(contact: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
  return name && contact.email
    ? `${name} (${contact.email})`
    : name || contact.email || 'Un client';
}
