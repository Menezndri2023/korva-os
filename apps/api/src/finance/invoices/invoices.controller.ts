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

@ApiTags('invoices')
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

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
