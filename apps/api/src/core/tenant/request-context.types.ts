import type { TenantContext } from '@korva/types';
import type { Request } from 'express';

export interface AuthenticatedUser {
  userId: string;
  email: string;
  /**
   * Set on a token KORVA's administration issued to look at one business's dashboard
   * (PlatformAdminService.viewAs): reads only (JwtAuthGuard), that organization only
   * (TenantGuard), never refreshed.
   */
  viewOnly?: { adminUserId: string; organizationId: string };
}

export interface RequestWithContext extends Request {
  user?: AuthenticatedUser;
  tenant?: TenantContext;
}
