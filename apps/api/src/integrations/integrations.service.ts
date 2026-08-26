import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type {
  IntegrationAccountRecord,
  IntegrationDomain,
} from './integrations.types';
import {
  IntegrationsRepository,
  toIntegrationAccountRecord,
} from './integrations.repository';
import { CredentialEncryptionService } from '../shared/crypto/credential-encryption.service';

/** Same permission bar `ApiKeysController` already gates create/list/revoke/rotate behind
 *  (`settings.manage` — see identity/api-keys/api-keys.controller.ts's class doc: "same
 *  permission bar as team invitations and organization settings"). Reused deliberately rather
 *  than inventing a new "integrations.manage" permission constant, since `Permission` is just
 *  `${string}.${string}` (packages/types/src/rbac.ts) — no schema change needed, and it keeps
 *  tenant integration management inside the existing settings-owner/admin bar rather than a new,
 *  undocumented one nobody's role actually grants yet. */
const MANAGE_TENANT_INTEGRATIONS_PERMISSION = 'settings.manage';

export interface CreateTenantIntegrationAccountInput {
  domain: IntegrationDomain;
  provider: string;
  role?: string;
  market?: string | null;
  secret?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreatePlatformIntegrationAccountInput {
  domain: IntegrationDomain;
  provider: string;
  role: string;
  market?: string | null;
  secret?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * The ONLY path in this codebase allowed to encrypt or decrypt an IntegrationAccount secret (see
 * docs/architecture/integrations-platform.md §3). Split into two halves on purpose:
 *
 * - Tenant-scope methods (top half) all take the caller's OWN `actorOrganizationId` — resolved
 *   server-side from their session/TenantContext, exactly like every other tenant-scoped service
 *   in this codebase (see TenantContext's own doc comment: "never trust an organizationId from
 *   the client body") — and `actorPermissions`, checked against `settings.manage` before any
 *   repository call. There is no method on this half that accepts an arbitrary/foreign
 *   organizationId; every lookup is filtered by the actor's own org via
 *   `IntegrationsRepository.findByIdForOrganization`, so a ForbiddenException/NotFoundException
 *   is the only possible outcome of trying to reach another org's row by id.
 *
 * - Platform-scope methods (bottom half) accept NO actor/organizationId parameter at all — by
 *   construction, not convention. Platform accounts (KORVA's own PSP/BSP-partner credentials)
 *   belong to no tenant (organizationId is *forbidden* for scope:'platform' — see schema doc),
 *   so there is no tenant-facing signature that could ever reach them: no controller in this
 *   Stage-1 lot binds to this half, and any future controller would have to explicitly add a new
 *   method call with a *different* signature to reach it — it cannot happen by passing a
 *   tenant's own id through the tenant-scope methods above.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly integrationsRepository: IntegrationsRepository,
    private readonly credentialEncryptionService: CredentialEncryptionService,
  ) {}

  // ---------------------------------------------------------------------------------------
  // Tenant-scope
  // ---------------------------------------------------------------------------------------

  async createTenantAccount(
    actorOrganizationId: string,
    actorPermissions: readonly string[],
    input: CreateTenantIntegrationAccountInput,
  ): Promise<IntegrationAccountRecord> {
    this.assertCanManageTenantIntegrations(actorPermissions);

    const doc = await this.integrationsRepository.create({
      scope: 'tenant',
      organizationId: new Types.ObjectId(actorOrganizationId),
      domain: input.domain,
      provider: input.provider,
      // `role` is a required, non-empty schema field (Mongoose treats '' as "missing" for a
      // required String — see integration-account.schema.spec.ts). It's not load-bearing for
      // tenant-scope uniqueness/lookup (see the schema's index comments), so default it to the
      // provider name when the caller doesn't supply one, rather than risk an empty string.
      role: input.role ?? input.provider,
      market: input.market ?? null,
      status: 'pending',
      secretEncrypted: input.secret
        ? this.credentialEncryptionService.encrypt(input.secret)
        : null,
      metadata: input.metadata ?? {},
    });

    return toIntegrationAccountRecord(doc);
  }

  async listTenantAccounts(
    actorOrganizationId: string,
    actorPermissions: readonly string[],
    domain?: IntegrationDomain,
  ): Promise<IntegrationAccountRecord[]> {
    this.assertCanManageTenantIntegrations(actorPermissions);
    const docs = await this.integrationsRepository.listByOrganization(
      actorOrganizationId,
      domain,
    );
    return docs.map(toIntegrationAccountRecord);
  }

  async getTenantAccount(
    actorOrganizationId: string,
    actorPermissions: readonly string[],
    id: string,
  ): Promise<IntegrationAccountRecord> {
    this.assertCanManageTenantIntegrations(actorPermissions);
    const doc = await this.requireOwnTenantAccount(actorOrganizationId, id);
    return toIntegrationAccountRecord(doc);
  }

  /** Rotation = insert a brand-new row carrying the new secret (status: 'active'), then mark the
   *  OLD row `status: 'revoked'` — never deleted, never mutated in place. Mirrors
   *  `ApiKeysService.rotate` exactly. */
  async rotateTenantAccountSecret(
    actorOrganizationId: string,
    actorPermissions: readonly string[],
    id: string,
    newSecret: string,
  ): Promise<IntegrationAccountRecord> {
    this.assertCanManageTenantIntegrations(actorPermissions);
    const existing = await this.requireOwnTenantAccount(
      actorOrganizationId,
      id,
    );

    if (existing.status === 'revoked') {
      throw new ForbiddenException({
        code: 'INTEGRATION_ACCOUNT_REVOKED',
        message: 'Cannot rotate an already-revoked integration account',
      });
    }

    const rotated = await this.integrationsRepository.create({
      scope: 'tenant',
      organizationId: new Types.ObjectId(actorOrganizationId),
      domain: existing.domain,
      provider: existing.provider,
      role: existing.role,
      market: existing.market,
      status: 'active',
      secretEncrypted: this.credentialEncryptionService.encrypt(newSecret),
      metadata: existing.metadata,
    });

    await this.integrationsRepository.revoke(id);

    return toIntegrationAccountRecord(rotated);
  }

  /** Revocation is a status update, never a delete — the row (and its audit trail) stays. */
  async revokeTenantAccount(
    actorOrganizationId: string,
    actorPermissions: readonly string[],
    id: string,
  ): Promise<IntegrationAccountRecord> {
    this.assertCanManageTenantIntegrations(actorPermissions);
    await this.requireOwnTenantAccount(actorOrganizationId, id);

    await this.integrationsRepository.revoke(id);

    const revoked = await this.requireOwnTenantAccount(actorOrganizationId, id);
    return toIntegrationAccountRecord(revoked);
  }

  // ---------------------------------------------------------------------------------------
  // Platform-scope — see class doc above for why nothing here takes an actor/organizationId.
  // No controller in this Stage-1 lot exposes these; they exist for ops tooling / a future
  // PaymentProviderResolver or MessagingProviderModule factory to seed and read KORVA's own
  // provider credentials (architecture doc §4/§5).
  // ---------------------------------------------------------------------------------------

  async createPlatformAccount(
    input: CreatePlatformIntegrationAccountInput,
  ): Promise<IntegrationAccountRecord> {
    const doc = await this.integrationsRepository.create({
      scope: 'platform',
      organizationId: null,
      domain: input.domain,
      provider: input.provider,
      role: input.role,
      market: input.market ?? null,
      status: 'pending',
      secretEncrypted: input.secret
        ? this.credentialEncryptionService.encrypt(input.secret)
        : null,
      metadata: input.metadata ?? {},
    });

    return toIntegrationAccountRecord(doc);
  }

  async listPlatformAccounts(
    domain?: IntegrationDomain,
  ): Promise<IntegrationAccountRecord[]> {
    const docs = await this.integrationsRepository.listPlatformAccounts(domain);
    return docs.map(toIntegrationAccountRecord);
  }

  /** The only method in this service that ever returns a decrypted secret in plaintext — and
   *  only for platform-scope accounts, via a signature that structurally cannot be reached from
   *  any tenant-facing call above. Returns `null` when the account holds no secret of its own
   *  (see architecture doc §2/§3), matching `secretEncrypted`'s nullable schema field. */
  async getDecryptedPlatformSecret(id: string): Promise<string | null> {
    const doc = await this.integrationsRepository.findByIdWithSecret(id);
    if (!doc || doc.scope !== 'platform') return null;
    if (!doc.secretEncrypted) return null;
    return this.credentialEncryptionService.decrypt(doc.secretEncrypted);
  }

  async rotatePlatformAccountSecret(
    id: string,
    newSecret: string,
  ): Promise<IntegrationAccountRecord> {
    const existing = await this.requirePlatformAccount(id);

    if (existing.status === 'revoked') {
      throw new ForbiddenException({
        code: 'INTEGRATION_ACCOUNT_REVOKED',
        message: 'Cannot rotate an already-revoked integration account',
      });
    }

    const rotated = await this.integrationsRepository.create({
      scope: 'platform',
      organizationId: null,
      domain: existing.domain,
      provider: existing.provider,
      role: existing.role,
      market: existing.market,
      status: 'active',
      secretEncrypted: this.credentialEncryptionService.encrypt(newSecret),
      metadata: existing.metadata,
    });

    await this.integrationsRepository.revoke(id);

    return toIntegrationAccountRecord(rotated);
  }

  async revokePlatformAccount(id: string): Promise<IntegrationAccountRecord> {
    await this.requirePlatformAccount(id);
    await this.integrationsRepository.revoke(id);
    const revoked = await this.requirePlatformAccount(id);
    return toIntegrationAccountRecord(revoked);
  }

  // ---------------------------------------------------------------------------------------

  private assertCanManageTenantIntegrations(
    actorPermissions: readonly string[],
  ): void {
    if (!actorPermissions.includes(MANAGE_TENANT_INTEGRATIONS_PERMISSION)) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        message: 'You do not have the required permissions for this action',
        details: { missing: [MANAGE_TENANT_INTEGRATIONS_PERMISSION] },
      });
    }
  }

  /** Every tenant-scope lookup goes through here — `id` is never trusted on its own; it must
   *  resolve to a row whose `organizationId` matches the caller's own, verified in the same
   *  database query (IntegrationsRepository.findByIdForOrganization), not as a separate
   *  after-the-fact check that could be skipped. */
  private async requireOwnTenantAccount(
    actorOrganizationId: string,
    id: string,
  ) {
    const doc = await this.integrationsRepository.findByIdForOrganization(
      id,
      actorOrganizationId,
    );
    if (!doc) {
      throw new NotFoundException({
        code: 'INTEGRATION_ACCOUNT_NOT_FOUND',
        message: 'Integration account not found',
      });
    }
    return doc;
  }

  private async requirePlatformAccount(id: string) {
    const doc = await this.integrationsRepository.findByIdWithSecret(id);
    if (!doc || doc.scope !== 'platform') {
      throw new NotFoundException({
        code: 'INTEGRATION_ACCOUNT_NOT_FOUND',
        message: 'Platform integration account not found',
      });
    }
    return doc;
  }
}
