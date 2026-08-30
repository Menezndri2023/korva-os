import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  aiChatSchema,
  listAiConversationsQuerySchema,
  type AiChatInput,
  type ListAiConversationsQuery,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../core/tenant/request-context.types';
import { AiOrchestratorService } from './ai-orchestrator.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { RequireModule } from '../common/decorators/require-module.decorator';

@ApiTags('ai')
@RequireModule('ai')
@Controller('ai')
export class AiController {
  constructor(private readonly aiOrchestratorService: AiOrchestratorService) {}

  @RequirePermissions('ai.use')
  @Post('chat')
  chat(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(aiChatSchema)) body: AiChatInput,
  ) {
    return this.aiOrchestratorService.chat(
      tenant.organizationId,
      { userId: user.userId, permissions: tenant.permissions },
      body,
    );
  }

  @RequirePermissions('ai.use')
  @Get('conversations')
  listConversations(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(listAiConversationsQuerySchema))
    query: ListAiConversationsQuery,
  ) {
    return this.aiOrchestratorService.listConversations(
      tenant.organizationId,
      user.userId,
      query,
    );
  }

  @RequirePermissions('ai.use')
  @Get('conversations/:id/messages')
  listMessages(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.aiOrchestratorService.listMessages(
      tenant.organizationId,
      user.userId,
      id,
    );
  }

  @RequirePermissions('ai.use')
  @Get('conversations/:id/pending-actions')
  listPendingActions(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.aiOrchestratorService.listPendingActions(
      tenant.organizationId,
      user.userId,
      id,
    );
  }

  @RequirePermissions('ai.use')
  @Post('actions/:id/confirm')
  confirmAction(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.aiOrchestratorService.confirmAction(
      tenant.organizationId,
      { userId: user.userId, permissions: tenant.permissions },
      id,
    );
  }

  @RequirePermissions('ai.use')
  @Post('actions/:id/reject')
  async rejectAction(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    await this.aiOrchestratorService.rejectAction(tenant.organizationId, id);
    return { rejected: true };
  }

  /** Token/cost totals are financial information, not a day-to-day chat capability — gated like
   *  every other settings/billing-adjacent read in this codebase (see organizations.controller.ts,
   *  webhook-subscriptions.controller.ts). */
  @RequirePermissions('settings.manage')
  @Get('usage-summary')
  getUsageSummary(@CurrentTenant() tenant: TenantContext) {
    return this.aiOrchestratorService.getUsageSummary(tenant.organizationId);
  }
}
