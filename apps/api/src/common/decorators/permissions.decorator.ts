import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@korva/types';

export const PERMISSIONS_KEY = 'permissions';

/** Requires the resolved TenantContext to include ALL of the given permissions. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
