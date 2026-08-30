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
  createQuoteSchema,
  listQuotesQuerySchema,
  updateQuoteSchema,
  type CreateQuoteInput,
  type ListQuotesQuery,
  type UpdateQuoteInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { QuotesService } from './quotes.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { OrganizationsService } from '../../organizations/organizations.service';
import { DocumentRenderingService } from '../../documents/rendering/document-rendering.service';
import { buildQuoteDocumentManifest } from '../../documents/templates/quote-document.template';

@ApiTags('quotes')
@RequireModule('finance')
@Controller('quotes')
export class QuotesController {
  constructor(
    private readonly quotesService: QuotesService,
    private readonly contactsService: ContactsService,
    private readonly organizationsService: OrganizationsService,
    private readonly documentRenderingService: DocumentRenderingService,
  ) {}

  @RequirePermissions('quotes.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listQuotesQuerySchema)) query: ListQuotesQuery,
  ) {
    return this.quotesService.list(tenant.organizationId, query);
  }

  @RequirePermissions('quotes.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.quotesService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('quotes.read')
  @Get(':id/pdf')
  async getPdf(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Res() res: Response,
  ): Promise<void> {
    const quote = await this.quotesService.getById(tenant.organizationId, id);
    const [organization, contact] = await Promise.all([
      this.organizationsService.getById(tenant.organizationId),
      this.contactsService.getById(
        tenant.organizationId,
        quote.contactId.toString(),
      ),
    ]);
    const manifest = buildQuoteDocumentManifest(quote, organization, contact);
    const buffer = await this.documentRenderingService.renderPdf(manifest);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', buffer.length.toString());
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${quote.number}.pdf"`,
    );
    res.send(buffer);
  }

  @RequirePermissions('quotes.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createQuoteSchema)) body: CreateQuoteInput,
  ) {
    return this.quotesService.create(tenant.organizationId, user.userId, body);
  }

  @RequirePermissions('quotes.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateQuoteSchema)) body: UpdateQuoteInput,
  ) {
    return this.quotesService.update(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }

  @RequirePermissions('quotes.update')
  @Post(':id/send')
  send(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.quotesService.send(tenant.organizationId, user.userId, id);
  }

  @RequirePermissions('quotes.approve')
  @Post(':id/accept')
  accept(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.quotesService.accept(tenant.organizationId, user.userId, id);
  }

  @RequirePermissions('quotes.approve')
  @Post(':id/reject')
  reject(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.quotesService.reject(tenant.organizationId, user.userId, id);
  }

  @RequirePermissions('quotes.approve', 'invoices.create')
  @Post(':id/convert-to-invoice')
  convertToInvoice(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.quotesService.convertToInvoice(
      tenant.organizationId,
      user.userId,
      id,
    );
  }
}
