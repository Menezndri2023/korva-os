import { BadRequestException } from '@nestjs/common';
import type { CreatePublicOrderInput } from '@korva/validation';
import type { FulfillmentMode } from '@korva/types';
import type { OrganizationDocument } from '../organizations/schemas/organization.schema';
import { zonedTimeToUtc } from '../booking/availability/availability.service';

/** How far ahead a customer may ask for their order. */
const MAX_REQUESTED_DAYS_AHEAD = 30;

export interface ResolvedFulfillment {
  shippingCost: number;
  shippingAddress?: {
    line1: string;
    line2?: string;
    city: string;
    postalCode: string;
    country: string;
  };
  fulfillmentMode?: FulfillmentMode;
  deliveryZoneName?: string;
  requestedFor?: Date;
  tableLabel?: string;
}

function completeAddress(input: CreatePublicOrderInput) {
  const address = input.shippingAddress;
  return address?.line1 && address.city && address.postalCode && address.country
    ? {
        line1: address.line1,
        line2: address.line2,
        city: address.city,
        postalCode: address.postalCode,
        country: address.country,
      }
    : undefined;
}

function badRequest(code: string, message: string): never {
  throw new BadRequestException({ code, message });
}

/**
 * Decides, server-side, how a storefront order is received and what delivery costs. Nothing the
 * public client sends about money is trusted: the fee comes from the organization's own zones or
 * flat rate.
 *
 * LEGACY PATH — an organization that never configured `fulfillmentModes` keeps exactly the
 * behaviour it had: the flat rate on every order, the address taken when complete, and any
 * fulfillment fields in the input ignored.
 *
 * CONFIGURED PATH — the customer must pick one of the offered modes:
 *  - delivery: a complete address is required; with zones, one must be named, its fee replaces
 *    the flat rate and its minimum basket is enforced (against the items' total before any
 *    discount code, which is what the customer sees when choosing the zone);
 *  - pickup and dine-in: no delivery fee — the flat rate used to be charged to customers who
 *    collected their order themselves — and no address kept.
 *
 * `requestedFor` arrives as a wall-clock date and time and is converted in the ORGANIZATION's
 * timezone. It must respect the preparation lead time and stay within MAX_REQUESTED_DAYS_AHEAD.
 */
export function resolveStorefrontFulfillment(
  organization: Pick<
    OrganizationDocument,
    | 'fulfillmentModes'
    | 'deliveryZones'
    | 'shippingFlatRate'
    | 'orderLeadTimeMinutes'
    | 'timezone'
  >,
  input: CreatePublicOrderInput,
  itemsSubtotal: number,
  now: Date = new Date(),
): ResolvedFulfillment {
  const modes = organization.fulfillmentModes;
  if (!modes || modes.length === 0) {
    return {
      shippingCost: organization.shippingFlatRate ?? 0,
      shippingAddress: completeAddress(input),
    };
  }

  const mode = input.fulfillmentMode;
  if (!mode || !modes.includes(mode)) {
    badRequest(
      'FULFILLMENT_MODE_REQUIRED',
      'Choose how you want to receive this order',
    );
  }

  let requestedFor: Date | undefined;
  if (input.requestedFor) {
    requestedFor = zonedTimeToUtc(
      input.requestedFor.date,
      input.requestedFor.time,
      organization.timezone,
    );
    const earliest =
      now.getTime() + (organization.orderLeadTimeMinutes ?? 0) * 60_000;
    const latest = now.getTime() + MAX_REQUESTED_DAYS_AHEAD * 24 * 3_600_000;
    if (
      Number.isNaN(requestedFor.getTime()) ||
      requestedFor.getTime() < earliest ||
      requestedFor.getTime() > latest
    ) {
      badRequest(
        'REQUESTED_TIME_UNAVAILABLE',
        'This time is too early or too far ahead for this business',
      );
    }
  }

  if (mode !== 'delivery') {
    return {
      shippingCost: 0,
      fulfillmentMode: mode,
      requestedFor,
      tableLabel:
        mode === 'dine_in' ? input.tableLabel?.trim() || undefined : undefined,
    };
  }

  const shippingAddress = completeAddress(input);
  if (!shippingAddress) {
    badRequest(
      'DELIVERY_ADDRESS_REQUIRED',
      'A full delivery address is required',
    );
  }

  const zones = organization.deliveryZones ?? [];
  if (zones.length === 0) {
    return {
      shippingCost: organization.shippingFlatRate ?? 0,
      shippingAddress,
      fulfillmentMode: mode,
      requestedFor,
    };
  }

  const zone = zones.find((candidate) => candidate.id === input.deliveryZoneId);
  if (!zone) {
    badRequest('DELIVERY_ZONE_REQUIRED', 'Choose a delivery zone');
  }
  if (zone.minimumOrder != null && itemsSubtotal < zone.minimumOrder) {
    badRequest(
      'BELOW_MINIMUM_ORDER',
      `The minimum order for ${zone.name} is ${zone.minimumOrder}`,
    );
  }
  return {
    shippingCost: zone.fee,
    shippingAddress,
    fulfillmentMode: mode,
    deliveryZoneName: zone.name,
    requestedFor,
  };
}
