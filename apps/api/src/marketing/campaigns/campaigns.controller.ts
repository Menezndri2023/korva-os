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
  createCampaignSchema,
  listCampaignRecipientsQuerySchema,
  listCampaignsQuerySchema,
  updateCampaignSchema,
  type CreateCampaignInput,
  type ListCampaignRecipientsQuery,
  type ListCampaignsQuery,
  type UpdateCampaignInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import type { AuthenticatedUser } from '../../core/tenant/request-context.types';
import { CampaignsService } from './campaigns.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('campaigns')
@RequireModule('marketing')
@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @RequirePermissions('campaigns.read')
  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(listCampaignsQuerySchema))
    query: ListCampaignsQuery,
  ) {
    return this.campaignsService.list(tenant.organizationId, query);
  }

  @RequirePermissions('campaigns.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.campaignsService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('campaigns.read')
  @Get(':id/recipients')
  listRecipients(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(listCampaignRecipientsQuerySchema))
    query: ListCampaignRecipientsQuery,
  ) {
    return this.campaignsService.listRecipients(
      tenant.organizationId,
      id,
      query,
    );
  }

  @RequirePermissions('campaigns.create')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createCampaignSchema))
    body: CreateCampaignInput,
  ) {
    return this.campaignsService.create(tenant.organizationId, body);
  }

  @RequirePermissions('campaigns.update')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateCampaignSchema))
    body: UpdateCampaignInput,
  ) {
    return this.campaignsService.update(tenant.organizationId, id, body);
  }

  @RequirePermissions('campaigns.send')
  @Post(':id/send')
  send(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.campaignsService.launch(tenant.organizationId, user.userId, id);
  }
}
