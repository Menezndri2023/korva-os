import {
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
  createInvoiceSchema,
  listInvoicesQuerySchema,
  updateInvoiceSchema,
  type CreateInvoiceInput,
  type ListInvoicesQuery,
  type UpdateInvoiceInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { InvoicesService } from './invoices.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { OrganizationsService } from '../../organizations/organizations.service';
import { DocumentRenderingService } from '../../documents/rendering/document-rendering.service';
import { buildInvoiceDocumentManifest } from '../../documents/templates/invoice-document.template';

@ApiTags('invoices')
@RequireModule('finance')
@Controller('invoices')
export class InvoicesController {
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly contactsService: ContactsService,
    private readonly organizationsService: OrganizationsService,
    private readonly documentRenderingService: DocumentRenderingService,
  ) {}

  @RequirePermissions('invoices.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listInvoicesQuerySchema))
    query: ListInvoicesQuery,
  ) {
    return this.invoicesService.list(tenant.organizationId, query);
  }

  @RequirePermissions('invoices.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.invoicesService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('invoices.read')
  @Get(':id/pdf')
  async getPdf(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const invoice = await this.invoicesService.getById(
      tenant.organizationId,
      id,
    );
    const [organization, contact] = await Promise.all([
      this.organizationsService.getById(tenant.organizationId),
      this.contactsService.getById(
        tenant.organizationId,
        invoice.contactId.toString(),
      ),
    ]);
    const manifest = buildInvoiceDocumentManifest(
      invoice,
      organization,
      contact,
    );
    const buffer = await this.documentRenderingService.renderPdf(manifest);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', buffer.length.toString());
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${invoice.number}.pdf"`,
    );
    res.send(buffer);
  }

  @RequirePermissions('invoices.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createInvoiceSchema)) body: CreateInvoiceInput,
  ) {
    return this.invoicesService.create(
      tenant.organizationId,
      user.userId,
      body,
    );
  }

  @RequirePermissions('invoices.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateInvoiceSchema)) body: UpdateInvoiceInput,
  ) {
    return this.invoicesService.update(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }

  @RequirePermissions('invoices.update')
  @Post(':id/issue')
  issue(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.invoicesService.issue(tenant.organizationId, user.userId, id);
  }

  @RequirePermissions('invoices.update')
  @Post(':id/cancel')
  cancel(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.invoicesService.cancel(tenant.organizationId, user.userId, id);
  }
}
