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
  createMessageTemplateSchema,
  updateMessageTemplateSchema,
  type CreateMessageTemplateInput,
  type UpdateMessageTemplateInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { MessageTemplatesService } from './message-templates.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('message-templates')
@RequireModule('communication')
@Controller('message-templates')
export class MessageTemplatesController {
  constructor(
    private readonly messageTemplatesService: MessageTemplatesService,
  ) {}

  @RequirePermissions('message_templates.read')
  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.messageTemplatesService.list(tenant.organizationId);
  }

  @RequirePermissions('message_templates.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.messageTemplatesService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('message_templates.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createMessageTemplateSchema))
    body: CreateMessageTemplateInput,
  ) {
    return this.messageTemplatesService.create(tenant.organizationId, body);
  }

  @RequirePermissions('message_templates.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMessageTemplateSchema))
    body: UpdateMessageTemplateInput,
  ) {
    return this.messageTemplatesService.update(tenant.organizationId, id, body);
  }

  @RequirePermissions('message_templates.delete')
  @Delete(':id')
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    await this.messageTemplatesService.delete(tenant.organizationId, id);
    return { deleted: true };
  }
}
