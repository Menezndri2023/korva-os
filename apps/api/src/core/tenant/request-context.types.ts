import type { TenantContext } from '@korva/types';
import type { Request } from 'express';

export interface AuthenticatedUser {
  userId: string;
  email: string;
}

export interface RequestWithContext extends Request {
  user?: AuthenticatedUser;
  tenant?: TenantContext;
}
