import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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
