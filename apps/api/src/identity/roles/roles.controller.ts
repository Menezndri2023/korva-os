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
  createRoleSchema,
  updateRoleSchema,
  type CreateRoleInput,
  type UpdateRoleInput,
} from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { RolesService } from './roles.service';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

/**
 * Custom (organization-defined) role management — distinct from the thin, addMember-oriented
 * `GET /organizations/me/roles` (OrganizationsController), which stays unchanged for its
 * existing caller. Same permission bar as inviting/removing a team member: managing what a
 * role can do is at least as sensitive as assigning one. System roles (OWNER/ADMIN/...) are
 * never reachable here — RolesService.assertEditableCustomRole fails closed on them.
 */
@ApiTags('roles')
@Controller('roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @RequirePermissions('settings.manage')
  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.rolesService.listFull(tenant.organizationId);
  }

  @RequirePermissions('settings.manage')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createRoleSchema)) body: CreateRoleInput,
  ) {
    return this.rolesService.createCustomRole(tenant.organizationId, body);
  }

  @RequirePermissions('settings.manage')
  @Patch(':id')
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateRoleSchema)) body: UpdateRoleInput,
  ) {
    return this.rolesService.updateCustomRole(tenant.organizationId, id, body);
  }

  @RequirePermissions('settings.manage')
  @Delete(':id')
  remove(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.rolesService.deleteCustomRole(tenant.organizationId, id);
  }
}
