import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@korva/types';

export const API_KEY_PERMISSIONS_KEY = 'apiKeyPermissions';

/**
 * Like `@RequirePermissions`, but read by `ApiKeyGuard` itself rather than the global
 * `PermissionsGuard`. A route authenticated via `X-API-Key` is marked `@Public()` (so the
 * global `JwtAuthGuard` doesn't also demand a Bearer token) which makes the global `TenantGuard`
 * skip tenant resolution too — so by the time the global `PermissionsGuard` runs,
 * `request.tenant` is never set yet, and it would reject on `@RequirePermissions` every time
 * regardless of the key's actual role. Using a distinct metadata key lets the global
 * `PermissionsGuard` pass through untouched (it only ever looks at `PERMISSIONS_KEY`) while
 * `ApiKeyGuard` — which runs afterwards and resolves the tenant itself — performs this check at
 * the point where it actually has something to check against.
 */
export const RequireApiKeyPermissions = (...permissions: Permission[]) =>
  SetMetadata(API_KEY_PERMISSIONS_KEY, permissions);
