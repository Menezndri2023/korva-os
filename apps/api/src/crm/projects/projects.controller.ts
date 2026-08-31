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
  createProjectSchema,
  listProjectsQuerySchema,
  updateProjectSchema,
  type CreateProjectInput,
  type ListProjectsQuery,
  type UpdateProjectInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { ProjectsService } from './projects.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('projects')
@RequireModule('crm')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @RequirePermissions('projects.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listProjectsQuerySchema))
    query: ListProjectsQuery,
  ) {
    return this.projectsService.list(tenant.organizationId, query);
  }

  @RequirePermissions('projects.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.projectsService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('projects.read')
  @Get(':id/summary')
  getSummary(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.projectsService.getSummary(tenant.organizationId, id);
  }

  @RequirePermissions('projects.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createProjectSchema)) body: CreateProjectInput,
  ) {
    return this.projectsService.create(tenant.organizationId, body);
  }

  @RequirePermissions('projects.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProjectSchema)) body: UpdateProjectInput,
  ) {
    return this.projectsService.update(tenant.organizationId, id, body);
  }
}
