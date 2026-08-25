import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  createPublicBookingSchema,
  createPublicOrderSchema,
  listPublicOffersQuerySchema,
  publicAvailabilityQuerySchema,
  type CreatePublicBookingInput,
  type CreatePublicOrderInput,
  type ListPublicOffersQuery,
  type PublicAvailabilityQuery,
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
 */
const PUBLIC_BOOKING_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

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
}
