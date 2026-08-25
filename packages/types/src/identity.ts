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

/** Metadata for a server-to-server API key — never the hash or the plaintext key itself. */
export interface ApiKeySummary {
  id: string;
  organizationId: string;
  name: string;
  /** e.g. "korva_live_ab12cd34" — safe to display, carries no usable entropy on its own. */
  keyPrefix: string;
  roleId: string;
  createdByUserId: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  rotatedFromKeyId?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Returned only from the create/rotate endpoints — `key` is never retrievable again after this. */
export interface CreatedApiKey extends ApiKeySummary {
  key: string;
}
