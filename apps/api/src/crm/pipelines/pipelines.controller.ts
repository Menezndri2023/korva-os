import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  createPipelineSchema,
  updatePipelineSchema,
  type CreatePipelineInput,
  type UpdatePipelineInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { PipelinesService } from './pipelines.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('pipelines')
@RequireModule('crm')
@Controller('pipelines')
export class PipelinesController {
  constructor(private readonly pipelinesService: PipelinesService) {}

  @RequirePermissions('leads.read')
  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.pipelinesService.list(tenant.organizationId);
  }

  @RequirePermissions('leads.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.pipelinesService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('settings.manage')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createPipelineSchema))
    body: CreatePipelineInput,
  ) {
    return this.pipelinesService.create(tenant.organizationId, body);
  }

  @RequirePermissions('settings.manage')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updatePipelineSchema))
    body: UpdatePipelineInput,
  ) {
    return this.pipelinesService.update(tenant.organizationId, id, body);
  }
}
