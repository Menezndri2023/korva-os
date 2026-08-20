import { NotFoundException, Injectable } from '@nestjs/common';
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
}
