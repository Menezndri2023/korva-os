import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  listAuditLogsQuerySchema,
  type ListAuditLogsQuery,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { AuditService } from './audit.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';

/** Same permission bar as webhook delivery logs and Organization settings — reading "who did
 *  what" is an org-oversight action, not a day-to-day CRM/finance/booking operation. Writes
 *  (AuditService.record) already happen from dozens of call sites; this is the first read
 *  surface for them. */
@ApiTags('audit')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @RequirePermissions('settings.manage')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listAuditLogsQuerySchema))
    query: ListAuditLogsQuery,
  ) {
    return this.auditService.list(tenant.organizationId, query);
  }
}
