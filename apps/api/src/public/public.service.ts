import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  STOREFRONT_SECTIONS,
  VERTICAL_TEMPLATES,
  getStorefrontTemplate,
  pickDeterministic,
  planMeetsMinimum,
  type KorvaModule,
  type PaymentMethod,
  type StorefrontSection,
  type StorefrontTheme,
} from '@korva/types';
import type {
  CreatePublicBookingInput,
  CreatePublicLeadInput,
  CreatePublicOrderInput,
  ListPublicOffersQuery,
  SearchPublicOffersQuery,
  TrackCartCheckoutStartedInput,
} from '@korva/validation';
import type { OfferDocument } from '../catalog/offers/schemas/offer.schema';
import { OrganizationsService } from '../organizations/organizations.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { OffersService } from '../catalog/offers/offers.service';
import { ReviewsService } from '../reviews/reviews.service';
import { AvailabilityService } from '../booking/availability/availability.service';
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
import { ContactsService } from '../crm/contacts/contacts.service';
import { LeadsService } from '../crm/leads/leads.service';
import { NotesService } from '../crm/notes/notes.service';
import { PipelinesService } from '../crm/pipelines/pipelines.service';
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

const ORDER_CONFIRMATION_BODY_TEMPLATE = `<p>Bonjour {{firstName}},</p>
<p>Votre commande <strong>{{orderNumber}}</strong> d'un montant de {{total}} {{currency}} a bien été enregistrée.</p>
<p>Vous pouvez suivre son statut à tout moment depuis la page de suivi de commande de la boutique.</p>`;

/**
 * Backs the public, unauthenticated storefront API (`/public/:organizationSlug/...`). Never
 * exposes internal fields (customFields, SKUs, blocked-slot reasons, ...) and never accepts
 * a price/total from the client — offers are always re-fetched server-side. See
 * docs/multi-tenancy.md: organizationId here comes from the slug, not a TenantContext, so
 * every method must resolve and re-check it itself rather than trusting a caller-supplied id.
 */
@Injectable()
export class PublicService {
  private readonly logger = new Logger(PublicService.name);

  constructor(
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
    private readonly pipelinesService: PipelinesService,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    private readonly reviewsService: ReviewsService,
    private readonly cartsService: CartsService,
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
    if (!organization.enabledModules.includes(module)) {
      throw new NotFoundException({
        code: 'MODULE_NOT_AVAILABLE',
        message: `This organization has not enabled "${module}"`,
      });
    }
  }

  async getOrganization(slug: string) {
    const organization = await this.resolveOrganization(slug);
    // Only this method is gated on 'website' — every other public route (catalog/booking/
    // commerce/leads) is independently gated on its own module and stays reachable regardless,
    // since those also power the embeddable widget on a business's own external site, a
    // distinct capability from KORVA's own hosted storefront page.
    this.assertModuleEnabled(organization, 'website');
    const plan = await this.subscriptionsService.getActivePlan(
      organization.id as string,
    );
    // Defense-in-depth, same reasoning as resolveStorefrontTheme's own plan clamp below: an
    // organization downgraded after saving testimonials/team/gallery/about/FAQ must stop showing
    // them on the public page even though the fields are still stored — enforced at save-time
    // by EntitlementsService.assertContentSectionsAllowed, re-checked here at read-time.
    const contentSectionsAllowed = planMeetsMinimum(plan.key, 'pro');
    return {
      name: organization.name,
      slug: organization.slug,
      type: organization.type,
      currency: organization.currency,
      language: organization.language,
      logo: organization.logo,
      brandColor: organization.brandColor,
      tagline: organization.tagline,
      heroImage: organization.heroImage,
      enabledModules: organization.enabledModules,
      visibleSections: this.computeVisibleSections(organization),
      shippingFlatRate: organization.shippingFlatRate,
      storefrontTheme: this.resolveStorefrontTheme(organization, plan.key),
      acceptedPaymentMethods:
        await this.resolveAvailablePaymentMethods(organization),
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
    const onlineAvailable = await this.isOnlinePaymentAvailable(
      organization.id as string,
    );
    if (onlineAvailable) {
      return configured;
    }
    const withoutOnline = configured.filter((m) => m !== 'online');
    return withoutOnline.length > 0 ? withoutOnline : ['cash'];
  }

  private async isOnlinePaymentAvailable(
    organizationId: string,
  ): Promise<boolean> {
    try {
      await this.paymentProviderResolver.resolve({
        flow: 'commerce',
        organizationId,
      });
      return true;
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
    const vertical = VERTICAL_TEMPLATES.find(
      (v) => v.suggestedType === organization.type,
    );
    const requestedKey =
      organization.storefrontTemplate ??
      vertical?.defaultStorefrontTemplate ??
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
    const palette =
      organization.storefrontPalette &&
      allowedPalettes.includes(organization.storefrontPalette)
        ? organization.storefrontPalette
        : pickDeterministic(seed, allowedPalettes);
    const fontPairing =
      organization.storefrontFontPairing &&
      allowedFontPairings.includes(organization.storefrontFontPairing)
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

    let offer: OfferDocument;
    try {
      offer = await this.offersService.getById(
        organization.id as string,
        offerId,
      );
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
    return this.toPublicOffer(offer);
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
    const { average, count, reviews } =
      await this.reviewsService.getPublicSummary(
        organization.id as string,
        offerId,
        page,
        limit,
      );
    return {
      average,
      count,
      reviews: reviews.map((review) => ({
        rating: review.rating,
        comment: review.comment,
        createdAt: (
          review as unknown as { createdAt: Date }
        ).createdAt.toISOString(),
      })),
    };
  }

  async listResources(slug: string) {
    const organization = await this.resolveOrganization(slug);
    this.assertModuleEnabled(organization, 'booking');

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

  async createBooking(slug: string, input: CreatePublicBookingInput) {
    const organization = await this.resolveOrganization(slug);
    this.assertModuleEnabled(organization, 'booking');
    const organizationId = organization.id as string;

    const contact = await this.contactsService.findOrCreateByEmail(
      organizationId,
      input.contact,
    );
    const booking = await this.bookingsService.create(
      organizationId,
      undefined,
      {
        resourceId: input.resourceId,
        offerId: input.offerId,
        startAt: input.startAt,
        endAt: input.endAt,
        contactId: contact.id as string,
        notes: input.notes,
      },
    );

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

    // Price/description are always re-resolved from the real Offer — never trusted from the public client.
    const offers = await Promise.all(
      input.items.map((item) =>
        this.offersService.getById(organizationId, item.offerId),
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
      return {
        offerId: item.offerId,
        variantId: item.variantId,
        description: variant ? `${offer.name} — ${variant.name}` : offer.name,
        quantity: item.quantity,
        unitPrice: variant?.priceOverride ?? offer.pricing.amount,
        taxRate: offer.pricing.taxRate,
      };
    });

    const address = input.shippingAddress;
    const shippingAddress =
      address?.line1 && address.city && address.postalCode && address.country
        ? {
            line1: address.line1,
            line2: address.line2,
            city: address.city,
            postalCode: address.postalCode,
            country: address.country,
          }
        : undefined;

    const order = await this.ordersService.createFromStorefront(
      organizationId,
      {
        contactId: contact.id as string,
        items,
        currency: input.currency,
        notes: input.notes,
        discountCode: input.discountCode,
        shippingCost: organization.shippingFlatRate,
        shippingAddress,
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
          subject: `Confirmation de commande ${order.number}`,
          body: interpolate(
            ORDER_CONFIRMATION_BODY_TEMPLATE,
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

    const invoice = order.invoiceId
      ? await this.invoicesService.getById(
          organizationId,
          order.invoiceId.toString(),
        )
      : await this.ordersService.generateInvoice(
          organizationId,
          undefined,
          orderId,
        );

    if (invoice.status === 'paid') {
      throw new BadRequestException({
        code: 'ORDER_ALREADY_PAID',
        message: 'This order has already been paid.',
      });
    }

    const storefrontUrl = (
      process.env.STOREFRONT_URL ?? 'http://localhost:3001'
    ).replace(/\/$/, '');
    const redirectUrl = `${storefrontUrl}/${slug}/track`;

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
   * (docs/BUSINESS_OS_AUDIT.md roadmap item #8). Creates (or reuses, by email) a Contact, a
   * Lead in the organization's default pipeline — created lazily if none exists yet, same
   * template the dashboard's own CRM page seeds by hand — and a Note carrying the visitor's
   * message, exactly mirroring how a staff member would capture the same inquiry manually.
   * `lead.created` is published for free by LeadsService.create, so this is immediately visible
   * to the Decision Engine/Workflow Engine like any other lead.
   */
  async createLead(slug: string, input: CreatePublicLeadInput) {
    const organization = await this.resolveOrganization(slug);
    this.assertModuleEnabled(organization, 'crm');
    const organizationId = organization.id as string;

    const contact = await this.contactsService.findOrCreateByEmail(
      organizationId,
      input.contact,
    );
    const pipeline =
      await this.pipelinesService.getOrCreateDefault(organizationId);
    const firstStage = pipeline.stages[0] as unknown as { _id: Types.ObjectId };
    const stageId = firstStage._id.toString();

    const lead = await this.leadsService.create(organizationId, undefined, {
      contactId: contact.id as string,
      source: input.source ?? 'website_widget',
      pipelineId: pipeline.id as string,
      stageId,
      customFields: {},
    });

    await this.notesService.create(organizationId, undefined, {
      entity: 'lead',
      entityId: lead.id as string,
      content: input.message,
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

    return {
      number: order.number,
      status: order.status,
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
