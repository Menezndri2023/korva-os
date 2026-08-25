import type { KorvaModule } from "./organization.ts";

export interface User {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  emailVerifiedAt?: string | null;
  /** Never accompanied by the TOTP secret itself — see UserSchema.totpSecretEncrypted. */
  totpEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** Resolved per-request tenant context — never trust an organizationId from the client body. */
export interface TenantContext {
  userId: string;
  organizationId: string;
  membershipId: string;
  roleId: string;
  permissions: string[];
  /** The active organization's currently activated modules — used by ModuleGuard. */
  enabledModules: KorvaModule[];
}
