import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { TenantContext } from '@korva/types';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { CustomerAccountsAdminService } from './customer-accounts-admin.service';

/** The dashboard's management of the business's own customer accounts. */
@ApiTags('customer-accounts')
@Controller('customer-accounts')
export class CustomerAccountsAdminController {
  constructor(private readonly service: CustomerAccountsAdminService) {}

  @RequirePermissions('contacts.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query('search') search?: string,
  ) {
    return this.service.list(tenant.organizationId, search);
  }

  @RequirePermissions('contacts.read')
  @Get('contact/:contactId')
  forContact(
    @CurrentTenant() tenant: TenantContext,
    @Param('contactId') contactId: string,
  ) {
    return this.service.forContact(tenant.organizationId, contactId);
  }

  @RequirePermissions('contacts.update')
  @Post(':id/disable')
  @HttpCode(200)
  disable(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.service.setDisabled(tenant.organizationId, id, true);
  }

  @RequirePermissions('contacts.update')
  @Post(':id/enable')
  @HttpCode(200)
  enable(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.service.setDisabled(tenant.organizationId, id, false);
  }

  @RequirePermissions('contacts.update')
  @Post(':id/password-reset')
  @HttpCode(200)
  async passwordReset(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    await this.service.sendPasswordReset(tenant.organizationId, id);
    return { sent: true };
  }
}
