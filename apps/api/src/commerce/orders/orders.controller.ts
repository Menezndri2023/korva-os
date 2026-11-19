import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import {
  addOrderItemSchema,
  createOpenOrderSchema,
  createOrderFromBookingSchema,
  createOrderSchema,
  listOrdersQuerySchema,
  splitOrderSchema,
  type AddOrderItemInput,
  type CreateOpenOrderInput,
  type CreateOrderFromBookingInput,
  type CreateOrderInput,
  type ListOrdersQuery,
  type SplitOrderInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { OrdersService } from './orders.service';
import { DonationReceiptService } from './donation-receipt.service';
import { OrganizationsService } from '../../organizations/organizations.service';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { DocumentRenderingService } from '../../documents/rendering/document-rendering.service';
import { buildDonationReceiptDocumentManifest } from '../../documents/templates/donation-receipt-document.template';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('orders')
@RequireModule('commerce')
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly donationReceiptService: DonationReceiptService,
    private readonly organizationsService: OrganizationsService,
    private readonly contactsService: ContactsService,
    private readonly documentRenderingService: DocumentRenderingService,
  ) {}

  @RequirePermissions('orders.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listOrdersQuerySchema)) query: ListOrdersQuery,
  ) {
    return this.ordersService.list(tenant.organizationId, query);
  }

  @RequirePermissions('orders.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.ordersService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('orders.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createOrderSchema)) body: CreateOrderInput,
  ) {
    return this.ordersService.create(tenant.organizationId, user.userId, body);
  }

  @RequirePermissions('orders.create', 'bookings.read')
  @Post('from-booking')
  createFromBooking(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createOrderFromBookingSchema))
    body: CreateOrderFromBookingInput,
  ) {
    return this.ordersService.createFromBooking(
      tenant.organizationId,
      user.userId,
      body.bookingId,
    );
  }

  @RequirePermissions('orders.create')
  @Post('open')
  createOpen(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createOpenOrderSchema))
    body: CreateOpenOrderInput,
  ) {
    return this.ordersService.createOpen(
      tenant.organizationId,
      user.userId,
      body,
    );
  }

  @RequirePermissions('orders.update')
  @Post(':id/items')
  addItem(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addOrderItemSchema)) body: AddOrderItemInput,
  ) {
    return this.ordersService.addItem(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }

  @RequirePermissions('orders.update')
  @Delete(':id/items/:index')
  removeItem(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('index', ParseIntPipe) index: number,
  ) {
    return this.ordersService.removeItem(
      tenant.organizationId,
      user.userId,
      id,
      index,
    );
  }

  @RequirePermissions('orders.update')
  @Post(':id/split')
  splitBill(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(splitOrderSchema)) body: SplitOrderInput,
  ) {
    return this.ordersService.splitBill(
      tenant.organizationId,
      user.userId,
      id,
      body.groups,
    );
  }

  @RequirePermissions('orders.update')
  @Post(':id/close')
  close(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ordersService.close(tenant.organizationId, user.userId, id);
  }

  @RequirePermissions('orders.update')
  @Post(':id/confirm')
  confirm(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ordersService.confirm(tenant.organizationId, user.userId, id);
  }

  @RequirePermissions('orders.cancel')
  @Post(':id/cancel')
  cancel(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ordersService.cancel(tenant.organizationId, user.userId, id);
  }

  @RequirePermissions('orders.update')
  @Post(':id/fulfill')
  fulfill(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ordersService.fulfill(tenant.organizationId, user.userId, id);
  }

  @RequirePermissions('orders.update', 'invoices.create')
  @Post(':id/generate-invoice')
  generateInvoice(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.ordersService.generateInvoice(
      tenant.organizationId,
      user.userId,
      id,
    );
  }

  /** Whether the order's donation receipt can be downloaded yet (paid, not refunded, holds a gift). */
  @RequirePermissions('orders.read')
  @Get(':id/donation-receipt/availability')
  async donationReceiptAvailability(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ): Promise<{ available: boolean }> {
    const order = await this.ordersService.getById(tenant.organizationId, id);
    return {
      available: await this.donationReceiptService.isAvailable(
        tenant.organizationId,
        order,
      ),
    };
  }

  /**
   * The association's copy of a donor's receipt — to send to a donor who gave without an
   * account (the storefront offers the same PDF to a donor who has one).
   */
  @RequirePermissions('orders.read')
  @Get(':id/donation-receipt')
  async getDonationReceipt(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const order = await this.ordersService.getById(tenant.organizationId, id);
    const receipt = await this.donationReceiptService.resolve(
      tenant.organizationId,
      order,
    );
    const [organization, contact] = await Promise.all([
      this.organizationsService.getById(tenant.organizationId),
      this.contactsService.getById(
        tenant.organizationId,
        order.contactId.toString(),
      ),
    ]);
    const buffer = await this.documentRenderingService.renderPdf(
      buildDonationReceiptDocumentManifest(receipt, organization, contact),
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', buffer.length.toString());
    res.setHeader(
      'Content-Disposition',
      `inline; filename="recu-don-${receipt.number}.pdf"`,
    );
    res.send(buffer);
  }
}
