import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createWorkflowSchema,
  testWorkflowSchema,
  updateWorkflowSchema,
  type CreateWorkflowInput,
  type TestWorkflowInput,
  type UpdateWorkflowInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { WorkflowsService } from './workflows.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { RequireModule } from '../common/decorators/require-module.decorator';

@ApiTags('workflows')
@RequireModule('workflow')
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflowsService: WorkflowsService) {}

  @RequirePermissions('workflows.read')
  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.workflowsService.list(tenant.organizationId);
  }

  @RequirePermissions('workflows.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.workflowsService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('workflows.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createWorkflowSchema))
    body: CreateWorkflowInput,
  ) {
    return this.workflowsService.create(tenant.organizationId, body);
  }

  @RequirePermissions('workflows.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWorkflowSchema))
    body: UpdateWorkflowInput,
  ) {
    return this.workflowsService.update(tenant.organizationId, id, body);
  }

  @RequirePermissions('workflows.delete')
  @Delete(':id')
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    await this.workflowsService.delete(tenant.organizationId, id);
    return { deleted: true };
  }

  @RequirePermissions('workflows.read')
  @Get(':id/executions')
  listExecutions(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    return this.workflowsService.listExecutions(tenant.organizationId, id);
  }

  @RequirePermissions('workflows.update')
  @Post(':id/test')
  test(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(testWorkflowSchema)) body: TestWorkflowInput,
  ) {
    return this.workflowsService.test(tenant.organizationId, id, body);
  }
}
