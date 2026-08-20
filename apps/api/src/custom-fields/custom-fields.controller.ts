import {
  BadRequestException,
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
  createCustomFieldSchema,
  updateCustomFieldSchema,
  type CreateCustomFieldInput,
  type UpdateCustomFieldInput,
} from '@korva/validation';
import {
  CUSTOM_FIELD_ENTITIES,
  type CustomFieldEntity,
  type TenantContext,
} from '@korva/types';
import { CustomFieldsService } from './custom-fields.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';

@ApiTags('custom-fields')
@Controller('custom-fields')
export class CustomFieldsController {
  constructor(private readonly customFieldsService: CustomFieldsService) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query('entity') entity: string,
  ) {
    if (!CUSTOM_FIELD_ENTITIES.includes(entity as CustomFieldEntity)) {
      throw new BadRequestException({
        code: 'INVALID_ENTITY',
        message: 'Unknown or missing entity query param',
      });
    }
    return this.customFieldsService.list(
      tenant.organizationId,
      entity as CustomFieldEntity,
    );
  }

  @RequirePermissions('settings.manage')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createCustomFieldSchema))
    body: CreateCustomFieldInput,
  ) {
    return this.customFieldsService.create(tenant.organizationId, body);
  }

  @RequirePermissions('settings.manage')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCustomFieldSchema))
    body: UpdateCustomFieldInput,
  ) {
    return this.customFieldsService.update(tenant.organizationId, id, body);
  }

  @RequirePermissions('settings.manage')
  @Delete(':id')
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    await this.customFieldsService.delete(tenant.organizationId, id);
    return { deleted: true };
  }
}
