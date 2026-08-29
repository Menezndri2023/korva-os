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
  createWebhookSubscriptionSchema,
  listWebhookDeliveriesQuerySchema,
  updateWebhookSubscriptionSchema,
  type CreateWebhookSubscriptionInput,
  type ListWebhookDeliveriesQuery,
  type UpdateWebhookSubscriptionInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { WebhookSubscriptionsService } from './webhook-subscriptions.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';

/** Same permission bar as API keys and Organization settings — configuring an outbound webhook
 *  is an org-configuration action, not a day-to-day CRM/finance/booking operation. */
@ApiTags('webhook-subscriptions')
@Controller('webhook-subscriptions')
export class WebhookSubscriptionsController {
  constructor(
    private readonly webhookSubscriptionsService: WebhookSubscriptionsService,
  ) {}

  @RequirePermissions('settings.manage')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createWebhookSubscriptionSchema))
    body: CreateWebhookSubscriptionInput,
  ) {
    return this.webhookSubscriptionsService.create(
      tenant.organizationId,
      tenant.userId,
      body,
    );
  }

  @RequirePermissions('settings.manage')
  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.webhookSubscriptionsService.list(tenant.organizationId);
  }

  @RequirePermissions('settings.manage')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.webhookSubscriptionsService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('settings.manage')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateWebhookSubscriptionSchema))
    body: UpdateWebhookSubscriptionInput,
  ) {
    return this.webhookSubscriptionsService.update(
      tenant.organizationId,
      tenant.userId,
      id,
      body,
    );
  }

  @RequirePermissions('settings.manage')
  @Delete(':id')
  async delete(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    await this.webhookSubscriptionsService.delete(
      tenant.organizationId,
      tenant.userId,
      id,
    );
    return { id, deleted: true };
  }

  @RequirePermissions('settings.manage')
  @Post(':id/rotate-secret')
  rotateSecret(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
  ) {
    return this.webhookSubscriptionsService.rotateSecret(
      tenant.organizationId,
      tenant.userId,
      id,
    );
  }

  @RequirePermissions('settings.manage')
  @Get(':id/deliveries')
  listDeliveries(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(listWebhookDeliveriesQuerySchema))
    query: ListWebhookDeliveriesQuery,
  ) {
    return this.webhookSubscriptionsService.listDeliveries(
      tenant.organizationId,
      id,
      query,
    );
  }
}
