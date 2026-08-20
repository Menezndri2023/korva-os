import { Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { NotificationsService } from './notifications.service';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @RequirePermissions('notifications.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('read') read?: string,
  ) {
    return this.notificationsService.list(tenant.organizationId, user.userId, {
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
      read: read === undefined ? undefined : read === 'true',
    });
  }

  @RequirePermissions('notifications.update')
  @Patch(':id/read')
  markRead(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.notificationsService.markRead(
      tenant.organizationId,
      user.userId,
      id,
    );
  }

  @RequirePermissions('notifications.update')
  @Post('read-all')
  async markAllRead(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const count = await this.notificationsService.markAllRead(
      tenant.organizationId,
      user.userId,
    );
    return { updated: count };
  }
}
