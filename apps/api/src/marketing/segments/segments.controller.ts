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
  createSegmentSchema,
  listSegmentsQuerySchema,
  previewSegmentSchema,
  updateSegmentSchema,
  type CreateSegmentInput,
  type ListSegmentsQuery,
  type PreviewSegmentInput,
  type UpdateSegmentInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { SegmentsService } from './segments.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('segments')
@RequireModule('marketing')
@Controller('segments')
export class SegmentsController {
  constructor(private readonly segmentsService: SegmentsService) {}

  @RequirePermissions('segments.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listSegmentsQuerySchema))
    query: ListSegmentsQuery,
  ) {
    return this.segmentsService.list(tenant.organizationId, query);
  }

  @RequirePermissions('segments.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.segmentsService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('segments.read')
  @Post('preview')
  preview(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(previewSegmentSchema))
    body: PreviewSegmentInput,
  ) {
    return this.segmentsService.preview(tenant.organizationId, body.criteria);
  }

  @RequirePermissions('segments.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createSegmentSchema)) body: CreateSegmentInput,
  ) {
    return this.segmentsService.create(tenant.organizationId, body);
  }

  @RequirePermissions('segments.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateSegmentSchema)) body: UpdateSegmentInput,
  ) {
    return this.segmentsService.update(tenant.organizationId, id, body);
  }

  @RequirePermissions('segments.delete')
  @Delete(':id')
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    await this.segmentsService.delete(tenant.organizationId, id);
    return { deleted: true };
  }
}
