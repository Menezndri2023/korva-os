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
  createConversationSchema,
  createMessageSchema,
  listConversationsQuerySchema,
  updateConversationSchema,
  type CreateConversationInput,
  type CreateMessageInput,
  type ListConversationsQuery,
  type UpdateConversationInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { ConversationsService } from './conversations.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('conversations')
@RequireModule('communication')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @RequirePermissions('conversations.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listConversationsQuerySchema))
    query: ListConversationsQuery,
  ) {
    return this.conversationsService.list(tenant.organizationId, query);
  }

  @RequirePermissions('conversations.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.conversationsService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('conversations.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createConversationSchema))
    body: CreateConversationInput,
  ) {
    return this.conversationsService.create(
      tenant.organizationId,
      user.userId,
      body,
    );
  }

  @RequirePermissions('conversations.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateConversationSchema))
    body: UpdateConversationInput,
  ) {
    return this.conversationsService.update(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }

  @RequirePermissions('conversations.read')
  @Get(':id/messages')
  listMessages(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    return this.conversationsService.listMessages(tenant.organizationId, id);
  }

  @RequirePermissions('conversations.create')
  @Post(':id/messages')
  sendMessage(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(createMessageSchema)) body: CreateMessageInput,
  ) {
    return this.conversationsService.sendMessage(
      tenant.organizationId,
      user.userId,
      id,
      body,
    );
  }
}
