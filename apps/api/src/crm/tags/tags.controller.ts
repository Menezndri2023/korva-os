import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiTags as ApiTagsDecorator } from '@nestjs/swagger';
import { createTagSchema, type CreateTagInput } from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { TagsService } from './tags.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

@ApiTagsDecorator('tags')
@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.tagsService.list(tenant.organizationId);
  }

  @RequirePermissions('contacts.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createTagSchema)) body: CreateTagInput,
  ) {
    return this.tagsService.create(tenant.organizationId, body);
  }
}
