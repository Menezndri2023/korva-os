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

@ApiTags('quotes')
@Controller('quotes')
export class QuotesController {
  constructor(private readonly quotesService: QuotesService) {}

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
