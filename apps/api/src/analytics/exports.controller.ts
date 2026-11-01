import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { dataExportQuerySchema, type DataExportQuery } from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { RequirePlanFeature } from '../common/decorators/require-plan-feature.decorator';
import { ExportsService } from './exports.service';

/**
 * The dashboard's Excel exports. One route per kind so each carries the permission of the data it
 * reveals — a cashier who cannot read the contact list cannot export it either.
 */
@ApiTags('exports')
@Controller('exports')
export class ExportsController {
  constructor(private readonly exportsService: ExportsService) {}

  @RequirePermissions('orders.read')
  @RequirePlanFeature('data_export')
  @Get('orders')
  orders(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(dataExportQuerySchema)) query: DataExportQuery,
  ) {
    return this.exportsService.export(tenant.organizationId, 'orders', query);
  }

  @RequirePermissions('bookings.read')
  @RequirePlanFeature('data_export')
  @Get('bookings')
  bookings(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(dataExportQuerySchema)) query: DataExportQuery,
  ) {
    return this.exportsService.export(tenant.organizationId, 'bookings', query);
  }

  @RequirePermissions('contacts.read')
  @RequirePlanFeature('data_export')
  @Get('contacts')
  contacts(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(dataExportQuerySchema)) query: DataExportQuery,
  ) {
    return this.exportsService.export(tenant.organizationId, 'contacts', query);
  }

  @RequirePermissions('invoices.read')
  @RequirePlanFeature('accounting_export')
  @Get('sales-journal')
  salesJournal(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(dataExportQuerySchema)) query: DataExportQuery,
  ) {
    return this.exportsService.export(
      tenant.organizationId,
      'sales-journal',
      query,
    );
  }
}
