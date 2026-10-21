import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import type { AuthenticatedUser } from '../core/tenant/request-context.types';
import { ActivationReportService } from './activation-report.service';

/** KORVA operators only — see ActivationReportService.assertPlatformAdmin. */
@ApiTags('platform')
@Controller('platform')
export class ActivationController {
  constructor(private readonly reportService: ActivationReportService) {}

  @SkipTenant()
  @Get('activation')
  async activation(@CurrentUser() user: AuthenticatedUser) {
    await this.reportService.assertPlatformAdmin(user.userId);
    return this.reportService.report();
  }
}
