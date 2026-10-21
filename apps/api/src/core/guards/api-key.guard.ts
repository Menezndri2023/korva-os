import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Reflector } from '@nestjs/core';
import { Model } from 'mongoose';
import type { Permission } from '@korva/types';
import { hashToken } from '../../identity/auth/token-hash.util';
import { ApiKeysRepository } from '../../identity/api-keys/api-keys.repository';
import { API_KEY_PERMISSIONS_KEY } from '../../identity/api-keys/require-api-key-permissions.decorator';
import { RolesService } from '../../identity/roles/roles.service';
import {
  Organization,
  OrganizationDocument,
} from '../../organizations/schemas/organization.schema';
import type { RequestWithContext } from '../tenant/request-context.types';

const API_KEY_HEADER = 'x-api-key';

/**
 * Authenticates a request via the `X-API-Key` header — a self-contained alternative to the
 * global `JwtAuthGuard` -> `TenantGuard` chain (see those files), applied only to routes that
 * explicitly opt in via `@UseGuards(ApiKeyGuard)` together with `@Public()` (Public so the
 * global JwtAuthGuard doesn't also demand a Bearer token on the same request; the global
 * TenantGuard also returns early on `@Public()`, leaving tenant resolution entirely to this
 * guard). It resolves `request.user`/`request.tenant` into the exact same shape
 * `MembershipsService.resolveTenantContext` builds from a JWT session, so `@CurrentTenant()` /
 * `@CurrentUser()` and downstream guards (`ModuleGuard`, whose metadata this guard doesn't
 * intercept) keep working unchanged.
 *
 * Deliberately does not modify `JwtAuthGuard`/`TenantGuard`/`app.module.ts`'s global guard
 * registration (outside this lot's file-ownership) — see `RequireApiKeyPermissions`'s doc for
 * why per-route permission checks for API-key-authenticated routes go through that decorator
 * (checked here) instead of the existing `@RequirePermissions` (checked by the global
 * `PermissionsGuard`, which would run — and always reject — before this guard has resolved a
 * tenant at all).
 *
 * Never logs the presented key or any hash of it; only success/failure and the resolved
 * organization ever reach the audit trail (see ApiKeysService).
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly apiKeysRepository: ApiKeysRepository,
    private readonly rolesService: RolesService,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithContext>();
    const presentedKey = request.header(API_KEY_HEADER);
    if (!presentedKey) {
      throw new UnauthorizedException({
        code: 'API_KEY_REQUIRED',
        message: `Missing ${API_KEY_HEADER} header`,
      });
    }

    const apiKey = await this.apiKeysRepository.findByHash(
      hashToken(presentedKey),
    );
    if (!apiKey) {
      throw new UnauthorizedException({
        code: 'INVALID_API_KEY',
        message: 'Invalid API key',
      });
    }
    if (apiKey.revokedAt) {
      throw new UnauthorizedException({
        code: 'API_KEY_REVOKED',
        message: 'This API key has been revoked',
      });
    }
    if (apiKey.expiresAt && apiKey.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({
        code: 'API_KEY_EXPIRED',
        message: 'This API key has expired',
      });
    }

    const [role, organization] = await Promise.all([
      this.rolesService.getRoleById(apiKey.roleId.toString()),
      this.organizationModel.findById(apiKey.organizationId).exec(),
    ]);
    if (!role || !organization) {
      // The role or organization was deleted out from under an otherwise-valid key — treat it
      // the same as an invalid key rather than leaking which part is missing.
      throw new UnauthorizedException({
        code: 'INVALID_API_KEY',
        message: 'Invalid API key',
      });
    }

    // A suspended organization's keys stop working with it — the same rule as TenantGuard.
    if (organization.suspendedAt) {
      throw new ForbiddenException({
        code: 'ORGANIZATION_SUSPENDED',
        message: 'This organization is suspended. Contact KORVA support.',
      });
    }

    // Best-effort — never let a lastUsedAt write turn a valid request into a failed one.
    void this.apiKeysRepository.touchLastUsed(apiKey.id as string);

    request.user = {
      userId: apiKey.createdByUserId.toString(),
      email: `api-key:${apiKey.name}`,
    };
    request.tenant = {
      userId: apiKey.createdByUserId.toString(),
      organizationId: apiKey.organizationId.toString(),
      membershipId: apiKey.id as string,
      roleId: role.id as string,
      permissions: role.permissions,
      enabledModules: organization.enabledModules,
    };

    const required = this.reflector.getAllAndOverride<Permission[]>(
      API_KEY_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (required && required.length > 0) {
      const granted = new Set(role.permissions);
      const missing = required.filter((permission) => !granted.has(permission));
      if (missing.length > 0) {
        throw new ForbiddenException({
          code: 'PERMISSION_DENIED',
          message:
            'This API key does not have the required permissions for this action',
          details: { missing },
        });
      }
    }

    return true;
  }
}
