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
  createCohortSchema,
  listCohortsQuerySchema,
  scheduleCohortSessionSchema,
  updateCohortSchema,
  type CreateCohortInput,
  type ListCohortsQuery,
  type ScheduleCohortSessionInput,
  type UpdateCohortInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { CohortsService } from './cohorts.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';

@ApiTags('cohorts')
@RequireModule('booking')
@Controller('cohorts')
export class CohortsController {
  constructor(private readonly cohortsService: CohortsService) {}

  @RequirePermissions('bookings.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listCohortsQuerySchema))
    query: ListCohortsQuery,
  ) {
    return this.cohortsService.list(tenant.organizationId, query);
  }

  @RequirePermissions('bookings.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.cohortsService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('bookings.read')
  @Get(':id/sessions')
  listSessions(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    return this.cohortsService.listSessions(tenant.organizationId, id);
  }

  /** One instructor's full teaching schedule across every cohort/course — the calendar-visibility
   *  counterpart to scheduleSession's own double-booking guard. */
  @RequirePermissions('bookings.read')
  @Get('instructors/:membershipId/sessions')
  listInstructorSessions(
    @CurrentTenant() tenant: TenantContext,
    @Param('membershipId') membershipId: string,
  ) {
    return this.cohortsService.listInstructorSessions(
      tenant.organizationId,
      membershipId,
    );
  }

  @RequirePermissions('bookings.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createCohortSchema)) body: CreateCohortInput,
  ) {
    return this.cohortsService.create(tenant.organizationId, body);
  }

  @RequirePermissions('bookings.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCohortSchema)) body: UpdateCohortInput,
  ) {
    return this.cohortsService.update(tenant.organizationId, id, body);
  }

  @RequirePermissions('bookings.create')
  @Post(':id/sessions')
  scheduleSession(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(scheduleCohortSessionSchema))
    body: ScheduleCohortSessionInput,
  ) {
    return this.cohortsService.scheduleSession(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }
}
