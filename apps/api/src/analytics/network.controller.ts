import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { RequirePlanFeature } from '../common/decorators/require-plan-feature.decorator';
import type { AuthenticatedUser } from '../core/tenant/request-context.types';
import { NetworkService } from './network.service';

/** Business: all the person's establishments side by side (see NetworkService). */
@ApiTags('network')
@Controller('network')
export class NetworkController {
  constructor(private readonly networkService: NetworkService) {}

  @RequirePermissions('analytics.read')
  @RequirePlanFeature('network_overview')
  @Get('overview')
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.networkService.overview(user.userId);
  }
}
