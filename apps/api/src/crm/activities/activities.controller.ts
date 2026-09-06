import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createActivitySchema,
  listRecentActivitiesQuerySchema,
  type CreateActivityInput,
  type ListRecentActivitiesQuery,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { ActivitiesService } from './activities.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('activities')
@RequireModule('crm')
@Controller('activities')
export class ActivitiesController {
  constructor(private readonly activitiesService: ActivitiesService) {}

  /** Most recent activity across every contact/lead in the org — backs the CRM "Activités" feed.
   *  A distinct path (not a query-param variant of the entity-filtered GET below), so there's no
   *  routing ambiguity between the two. */
  @RequirePermissions('contacts.read')
  @Get('recent')
  listRecent(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listRecentActivitiesQuerySchema))
    query: ListRecentActivitiesQuery,
  ) {
    return this.activitiesService.listRecent(
      tenant.organizationId,
      query.page,
      query.limit,
    );
  }

  @RequirePermissions('contacts.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query('entity') entity: string,
    @Query('entityId') entityId: string,
  ) {
    if (
      (entity !== 'contact' && entity !== 'lead' && entity !== 'deal') ||
      !entityId
    ) {
      throw new BadRequestException({
        code: 'INVALID_QUERY',
        message:
          'entity ("contact", "lead" or "deal") and entityId are required',
      });
    }
    return this.activitiesService.listForEntity(
      tenant.organizationId,
      entity,
      entityId,
    );
  }

  @RequirePermissions('contacts.update')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createActivitySchema))
    body: CreateActivityInput,
  ) {
    return this.activitiesService.create(
      tenant.organizationId,
      user.userId,
      body,
    );
  }
}
