import { NotFoundException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  STOREFRONT_SECTIONS,
  type KorvaModule,
  type StorefrontSection,
} from '@korva/types';
import type {
  CreatePublicBookingInput,
  CreatePublicLeadInput,
  CreatePublicOrderInput,
  ListPublicOffersQuery,
} from '@korva/validation';
import { OrganizationsService } from '../organizations/organizations.service';
import { OffersService } from '../catalog/offers/offers.service';
import { AvailabilityService } from '../booking/availability/availability.service';
import { BookingsService } from '../booking/bookings/bookings.service';
import { ResourcesService } from '../booking/resources/resources.service';
import { OrdersService } from '../commerce/orders/orders.service';
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

/**
 * Backs the public, unauthenticated storefront API (`/public/:organizationSlug/...`). Never
 * exposes internal fields (customFields, SKUs, blocked-slot reasons, ...) and never accepts
 * a price/total from the client — offers are always re-fetched server-side. See
 * docs/multi-tenancy.md: organizationId here comes from the slug, not a TenantContext, so
 * every method must resolve and re-check it itself rather than trusting a caller-supplied id.
 */
@Injectable()
export class PublicService {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly offersService: OffersService,
    private readonly availabilityService: AvailabilityService,
    private readonly bookingsService: BookingsService,
    private readonly resourcesService: ResourcesService,
    private readonly ordersService: OrdersService,
    private readonly contactsService: ContactsService,
    private readonly leadsService: LeadsService,
    private readonly notesService: NotesService,
    private readonly pipelinesService: PipelinesService,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
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

  async listOffers(slug: string, query: ListPublicOffersQuery) {
    const organization = await this.resolveOrganization(slug);
    this.assertModuleEnabled(organization, 'catalog');

    const { data } = await this.offersService.list(organization.id as string, {
      page: 1,
      limit: 50,
      status: 'active',
      type: query.type,
    });
    return data.map((offer) => ({
      id: offer.id as string,
      type: offer.type,
      name: offer.name,
      description: offer.description,
      images: offer.images,
      categories: offer.categories,
      pricing: offer.pricing,
      variants: offer.variants,
    }));
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
    const items = input.items.map((item, index) => ({
      offerId: item.offerId,
      description: offers[index]!.name,
      quantity: item.quantity,
      unitPrice: offers[index]!.pricing.amount,
      taxRate: offers[index]!.pricing.taxRate,
    }));

    const order = await this.ordersService.createFromStorefront(
      organizationId,
      {
        contactId: contact.id as string,
        items,
        currency: input.currency,
        notes: input.notes,
      },
    );

    return {
      id: order.id as string,
      number: order.number,
      total: order.total,
      currency: order.currency,
      status: order.status,
    };
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
