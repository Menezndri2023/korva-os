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
import { Throttle } from '@nestjs/throttler';
import {
  addMemberSchema,
  createOrganizationSchema,
  importOrganizationPreviewSchema,
  updateMemberCommissionRateSchema,
  updateMemberRateSchema,
  updateMemberRoleSchema,
  updateOrganizationSchema,
  type AddMemberInput,
  type CreateOrganizationInput,
  type ImportOrganizationPreviewInput,
  type UpdateMemberCommissionRateInput,
  type UpdateMemberRateInput,
  type UpdateMemberRoleInput,
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

  /** Onboarding's "importer mon entreprise" step — triggers a server-side outbound fetch, so
   *  it's throttled the same way PUBLIC_BOOKING_THROTTLE gates other server-triggered-fetch
   *  endpoints in this codebase, to stop it being usable as a free URL-probing proxy. */
  @SkipTenant()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('import-preview')
  importPreview(
    @Body(new ZodValidationPipe(importOrganizationPreviewSchema))
    body: ImportOrganizationPreviewInput,
  ) {
    return this.organizationsService.importPreviewFromUrl(body.url);
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

  @RequirePermissions('settings.manage')
  @Patch('me/members/:id')
  updateMemberRole(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMemberRoleSchema))
    body: UpdateMemberRoleInput,
  ) {
    return this.organizationsService.updateMemberRole(
      tenant.organizationId,
      user.userId,
      tenant.roleId,
      id,
      body.roleId,
    );
  }

  @RequirePermissions('settings.manage')
  @Patch('me/members/:id/rate')
  updateMemberRate(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMemberRateSchema))
    body: UpdateMemberRateInput,
  ) {
    return this.organizationsService.updateMemberRate(
      tenant.organizationId,
      user.userId,
      id,
      body.defaultHourlyRate,
    );
  }

  @RequirePermissions('settings.manage')
  @Patch('me/members/:id/commission-rate')
  updateMemberCommissionRate(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateMemberCommissionRateSchema))
    body: UpdateMemberCommissionRateInput,
  ) {
    return this.organizationsService.updateMemberCommissionRate(
      tenant.organizationId,
      user.userId,
      id,
      body.commissionRateBasisPoints,
    );
  }

  @RequirePermissions('settings.manage')
  @Delete('me/members/:id')
  removeMember(
    @CurrentTenant() tenant: TenantContext,
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.organizationsService.removeMember(
      tenant.organizationId,
      user.userId,
      tenant.roleId,
      id,
    );
  }
}
