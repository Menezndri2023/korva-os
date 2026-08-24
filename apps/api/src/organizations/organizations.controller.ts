import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  addMemberSchema,
  createOrganizationSchema,
  updateOrganizationSchema,
  type AddMemberInput,
  type CreateOrganizationInput,
  type UpdateOrganizationInput,
} from '@korva/validation';
import { OrganizationsService } from './organizations.service';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CurrentTenant } from '../common/decorators/current-tenant.decorator';
import { SkipTenant } from '../common/decorators/skip-tenant.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import type { AuthenticatedUser } from '../core/tenant/request-context.types';
import type { TenantContext } from '@korva/types';

@ApiTags('organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @SkipTenant()
  @Get('me/all')
  listMine(@CurrentUser() user: AuthenticatedUser) {
    return this.organizationsService.listForUser(user.userId);
  }

  @SkipTenant()
  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(createOrganizationSchema))
    body: CreateOrganizationInput,
  ) {
    return this.organizationsService.createForOwner(user.userId, body);
  }

  @Get('me')
  getActive(@CurrentTenant() tenant: TenantContext) {
    return this.organizationsService.getById(tenant.organizationId);
  }

  @RequirePermissions('settings.manage')
  @Patch('me')
  updateActive(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(updateOrganizationSchema))
    body: UpdateOrganizationInput,
  ) {
    return this.organizationsService.update(tenant.organizationId, body);
  }

  @Get('me/members')
  listMembers(@CurrentTenant() tenant: TenantContext) {
    return this.organizationsService.listMembers(tenant.organizationId);
  }

  @RequirePermissions('settings.manage')
  @Get('me/roles')
  listRoles(@CurrentTenant() tenant: TenantContext) {
    return this.organizationsService.listRoles(tenant.organizationId);
  }

  @RequirePermissions('settings.manage')
  @Post('me/members')
  addMember(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(addMemberSchema)) body: AddMemberInput,
  ) {
    return this.organizationsService.addMember(
      tenant.organizationId,
      tenant.userId,
      tenant.roleId,
      body,
    );
  }
}
