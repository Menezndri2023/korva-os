import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
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
import { ContactsService } from '../../crm/contacts/contacts.service';
import { OffersService } from '../../catalog/offers/offers.service';
import { OrganizationsService } from '../../organizations/organizations.service';
import { DocumentRenderingService } from '../../documents/rendering/document-rendering.service';
import { buildCertificateDocumentManifest } from '../../documents/templates/certificate-document.template';

@ApiTags('bookings')
@RequireModule('booking')
@Controller('bookings')
export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    private readonly contactsService: ContactsService,
    private readonly offersService: OffersService,
    private readonly organizationsService: OrganizationsService,
    private readonly documentRenderingService: DocumentRenderingService,
  ) {}

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

  @RequirePermissions('bookings.read')
  @Get(':id/certificate')
  async getCertificate(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const booking = await this.bookingsService.getById(
      tenant.organizationId,
      id,
    );
    if (booking.status !== 'completed') {
      throw new BadRequestException({
        code: 'CERTIFICATE_NOT_AVAILABLE',
        message: 'A certificate is only available for a completed booking',
      });
    }
    const [offer, organization, contact] = await Promise.all([
      this.offersService.getById(
        tenant.organizationId,
        booking.offerId.toString(),
      ),
      this.organizationsService.getById(tenant.organizationId),
      this.contactsService.getById(
        tenant.organizationId,
        booking.contactId.toString(),
      ),
    ]);
    const manifest = buildCertificateDocumentManifest(
      booking,
      offer,
      organization,
      contact,
    );
    const buffer = await this.documentRenderingService.renderPdf(manifest);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', buffer.length.toString());
    res.setHeader('Content-Disposition', `inline; filename="certificate.pdf"`);
    res.send(buffer);
  }
}
