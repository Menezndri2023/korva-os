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
  addBlockedSlotSchema,
  createResourceSchema,
  updateResourceSchema,
  type AddBlockedSlotInput,
  type CreateResourceInput,
  type UpdateResourceInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { ResourcesService } from './resources.service';
import { OrganizationsService } from '../../organizations/organizations.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { RequireModule } from '../../common/decorators/require-module.decorator';

@ApiTags('resources')
@RequireModule('booking')
@Controller('resources')
export class ResourcesController {
  constructor(
    private readonly resourcesService: ResourcesService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  @RequirePermissions('bookings.read')
  @Get()
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query('active') active?: string,
    @Query('membershipId') membershipId?: string,
  ) {
    // Same default as the public site: a business with booking on is never left with nobody.
    const organization = await this.organizationsService.getById(
      tenant.organizationId,
    );
    await this.resourcesService.ensureDefaultResource(
      tenant.organizationId,
      organization.name,
      organization.businessModel,
    );
    return this.resourcesService.list(
      tenant.organizationId,
      active === 'true',
      membershipId,
    );
  }

  @RequirePermissions('bookings.read')
  @Get(':id')
  getById(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.resourcesService.getById(tenant.organizationId, id);
  }

  @RequirePermissions('settings.manage')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createResourceSchema))
    body: CreateResourceInput,
  ) {
    return this.resourcesService.create(tenant.organizationId, body);
  }

  @RequirePermissions('settings.manage')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateResourceSchema))
    body: UpdateResourceInput,
  ) {
    return this.resourcesService.update(tenant.organizationId, id, body);
  }

  @RequirePermissions('settings.manage')
  @Post(':id/blocked-slots')
  addBlockedSlot(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addBlockedSlotSchema))
    body: AddBlockedSlotInput,
  ) {
    return this.resourcesService.addBlockedSlot(
      tenant.organizationId,
      id,
      body,
    );
  }

  @RequirePermissions('settings.manage')
  @Delete(':id/blocked-slots/:slotId')
  removeBlockedSlot(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Param('slotId') slotId: string,
  ) {
    return this.resourcesService.removeBlockedSlot(
      tenant.organizationId,
      id,
      slotId,
    );
  }
}
