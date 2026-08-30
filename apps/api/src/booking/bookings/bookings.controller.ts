import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  completeBookingSchema,
  createBookingSchema,
  listBookingsQuerySchema,
  rescheduleBookingSchema,
  updateBookingSchema,
  type CompleteBookingInput,
  type CreateBookingInput,
  type ListBookingsQuery,
  type RescheduleBookingInput,
  type UpdateBookingInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { BookingsService } from './bookings.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('bookings')
@RequireModule('booking')
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @RequirePermissions('bookings.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listBookingsQuerySchema))
    query: ListBookingsQuery,
  ) {
    return this.bookingsService.list(tenant.organizationId, query);
  }

  @RequirePermissions('bookings.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.bookingsService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('bookings.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createBookingSchema)) body: CreateBookingInput,
  ) {
    return this.bookingsService.create(
      tenant.organizationId,
      user.userId,
      body,
    );
  }

  @RequirePermissions('bookings.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateBookingSchema)) body: UpdateBookingInput,
  ) {
    return this.bookingsService.update(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }

  @RequirePermissions('bookings.update')
  @Post(':id/reschedule')
  reschedule(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(rescheduleBookingSchema))
    body: RescheduleBookingInput,
  ) {
    return this.bookingsService.reschedule(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }

  @RequirePermissions('bookings.cancel')
  @Post(':id/cancel')
  cancel(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.bookingsService.cancel(tenant.organizationId, user.userId, id);
  }

  @RequirePermissions('bookings.update')
  @Post(':id/complete')
  complete(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(completeBookingSchema))
    body: CompleteBookingInput,
  ) {
    return this.bookingsService.complete(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }
}
