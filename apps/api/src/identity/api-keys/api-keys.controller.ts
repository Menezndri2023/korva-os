import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createApiKeySchema, type CreateApiKeyInput } from '@korva/validation';
import type { TenantContext } from '@korva/types';
import { ApiKeysService } from './api-keys.service';
import { RequireApiKeyPermissions } from './require-api-key-permissions.decorator';
import { ApiKeyGuard } from '../../core/guards/api-key.guard';
import type { RequestWithContext } from '../../core/tenant/request-context.types';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Public } from '../../common/decorators/public.decorator';

/**
 * Management endpoints (create/list/revoke/rotate) are ordinary JWT-authenticated dashboard
 * routes, gated by `settings.manage` — same permission bar as team invitations and organization
 * settings — and go through the normal global JwtAuthGuard/TenantGuard/PermissionsGuard chain
 * unchanged. `whoami*` below are the odd ones out: they authenticate via `X-API-Key` instead,
 * through `ApiKeyGuard` — see that guard's class doc for why they need `@Public()`.
 */
@ApiTags('organizations')
@Controller('organizations/me/api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @RequirePermissions('settings.manage')
  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(createApiKeySchema)) body: CreateApiKeyInput,
  ) {
    return this.apiKeysService.create(
      tenant.organizationId,
      tenant.userId,
      tenant.roleId,
      body,
    );
  }

  @RequirePermissions('settings.manage')
  @Get()
  list(@CurrentTenant() tenant: TenantContext) {
    return this.apiKeysService.list(tenant.organizationId);
  }

  @RequirePermissions('settings.manage')
  @Delete(':id')
  revoke(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.apiKeysService.revoke(tenant.organizationId, tenant.userId, id);
  }

  @RequirePermissions('settings.manage')
  @Post(':id/rotate')
  rotate(@CurrentTenant() tenant: TenantContext, @Param('id') id: string) {
    return this.apiKeysService.rotate(tenant.organizationId, tenant.userId, id);
  }

  /**
   * Proves ApiKeyGuard resolves a usable tenant from a bare `X-API-Key` header — any
   * non-revoked, non-expired key belonging to some organization succeeds here regardless of its
   * role's permissions.
   */
  @Public()
  @UseGuards(ApiKeyGuard)
  @Get('whoami')
  whoami(@Req() req: RequestWithContext) {
    return {
      organizationId: req.tenant?.organizationId,
      roleId: req.tenant?.roleId,
      permissions: req.tenant?.permissions,
    };
  }

  /**
   * Same authentication as `whoami`, but additionally requires the key's role to carry
   * `settings.manage` — demonstrates per-route scope enforcement for API-key-authenticated
   * requests (see `RequireApiKeyPermissions`'s doc for why this can't be the ordinary
   * `@RequirePermissions`).
   */
  @Public()
  @UseGuards(ApiKeyGuard)
  @RequireApiKeyPermissions('settings.manage')
  @Get('whoami/settings-check')
  whoamiSettingsCheck(@Req() req: RequestWithContext) {
    return { organizationId: req.tenant?.organizationId, ok: true };
  }
}
