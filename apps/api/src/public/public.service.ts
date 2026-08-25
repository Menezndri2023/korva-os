import { NotFoundException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { KorvaModule } from '@korva/types';
import type {
  CreatePublicBookingInput,
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
      enabledModules: organization.enabledModules,
    };
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
