import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  commissionReportQuerySchema,
  createTimeEntrySchema,
  generateInvoiceFromTimeEntriesSchema,
  listTimeEntriesQuerySchema,
  updateTimeEntrySchema,
  type CommissionReportQuery,
  type CreateTimeEntryInput,
  type GenerateInvoiceFromTimeEntriesInput,
  type ListTimeEntriesQuery,
  type UpdateTimeEntryInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { TimeEntriesService } from './time-entries.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('time-entries')
@RequireModule('finance')
@Controller('time-entries')
export class TimeEntriesController {
  constructor(private readonly timeEntriesService: TimeEntriesService) {}

  @RequirePermissions('time_entries.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listTimeEntriesQuerySchema))
    query: ListTimeEntriesQuery,
  ) {
    return this.timeEntriesService.list(tenant.organizationId, query);
  }

  // Registered before Get(':id') — a static segment must be matched before the dynamic :id
  // route below it, or NestJS/Express would treat "commission-report" as an :id value.
  @RequirePermissions('settings.manage')
  @Get('commission-report/:userId')
  getCommissionReport(
    @CurrentTenant() tenant: TenantContext,
    @Param('userId') userId: string,
    @Query(new ZodValidationPipe(commissionReportQuerySchema))
    query: CommissionReportQuery,
  ) {
    return this.timeEntriesService.getCommissionReport(
      tenant.organizationId,
      userId,
      query.from,
      query.to,
    );
  }

  @RequirePermissions('time_entries.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.timeEntriesService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('time_entries.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createTimeEntrySchema))
    body: CreateTimeEntryInput,
  ) {
    return this.timeEntriesService.create(
      tenant.organizationId,
      user.userId,
      body,
    );
  }

  @RequirePermissions('time_entries.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateTimeEntrySchema))
    body: UpdateTimeEntryInput,
  ) {
    return this.timeEntriesService.update(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }

  @RequirePermissions('time_entries.approve')
  @Post(':id/approve')
  approve(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.timeEntriesService.approve(
      tenant.organizationId,
      user.userId,
      id,
    );
  }

  @RequirePermissions('time_entries.update')
  @Post(':id/void')
  void(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.timeEntriesService.void(tenant.organizationId, user.userId, id);
  }

  @RequirePermissions('time_entries.delete')
  @Delete(':id')
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    await this.timeEntriesService.delete(
      tenant.organizationId,
      user.userId,
      id,
    );
    return { deleted: true };
  }

  @RequirePermissions('time_entries.approve', 'invoices.create')
  @Post('generate-invoice')
  generateInvoice(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(generateInvoiceFromTimeEntriesSchema))
    body: GenerateInvoiceFromTimeEntriesInput,
  ) {
    return this.timeEntriesService.generateInvoice(
      tenant.organizationId,
      user.userId,
      body,
    );
  }
}
