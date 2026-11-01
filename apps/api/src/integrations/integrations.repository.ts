import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  IntegrationAccount,
  IntegrationAccountDocument,
} from './schemas/integration-account.schema';
import type {
  IntegrationAccountRecord,
  IntegrationAccountStatus,
  IntegrationAccountsReader,
  IntegrationDomain,
  IntegrationScope,
} from './integrations.types';

export interface CreateIntegrationAccountInput {
  scope: IntegrationScope;
  organizationId: Types.ObjectId | null;
  domain: IntegrationDomain;
  provider: string;
  role: string;
  market: string | null;
  status?: IntegrationAccountStatus;
  secretEncrypted?: string | null;
  metadata?: Record<string, unknown>;
  /** False to create a row outside the uniqueness slot (a rotation's replacement, promoted with
   *  setLive once the old row is revoked). Defaults to live. */
  isLive?: boolean;
}

/**
 * Mongoose repository for IntegrationAccount. `findPlatformAccount`/`findTenantAccount` satisfy
 * `IntegrationAccountsReader` (see integrations.types.ts) — they are the only two methods other
 * Wave 4 agents' resolvers will ever inject, and they map every result through
 * `toIntegrationAccountRecord`, which only reads the fields `IntegrationAccountRecord` declares.
 * `secretEncrypted` is `select: false` on the schema, so a plain `find()`/`findOne()` never even
 * loads it into the returned document in the first place — the mapping below is a second,
 * belt-and-suspenders guarantee on top of that.
 */
@Injectable()
export class IntegrationsRepository implements IntegrationAccountsReader {
  constructor(
    @InjectModel(IntegrationAccount.name)
    private readonly model: Model<IntegrationAccountDocument>,
  ) {}

  create(
    input: CreateIntegrationAccountInput,
  ): Promise<IntegrationAccountDocument> {
    return this.model.create({
      ...input,
      status: input.status ?? 'pending',
      secretEncrypted: input.secretEncrypted ?? null,
      metadata: input.metadata ?? {},
    });
  }

  /** Includes `secretEncrypted` (explicitly re-selected) — reserved for IntegrationsService's own
   *  encrypt/decrypt path. Never call this from any read-only/lookup path a resolver can reach. */
  findByIdWithSecret(id: string): Promise<IntegrationAccountDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.model.findById(id).select('+secretEncrypted').exec();
  }

  /** Tenant-scoped by construction — `organizationId` is part of the filter, never trusted from
   *  the caller as "already verified". Never selects `secretEncrypted`. */
  findByIdForOrganization(
    id: string,
    organizationId: string,
  ): Promise<IntegrationAccountDocument | null> {
    if (
      !Types.ObjectId.isValid(id) ||
      !Types.ObjectId.isValid(organizationId)
    ) {
      return Promise.resolve(null);
    }
    return this.model
      .findOne({
        _id: id,
        scope: 'tenant',
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  /** Tenant-equivalent of `findByIdWithSecret` — same organizationId-in-the-query guarantee as
   *  `findByIdForOrganization` above, but additionally re-selects `secretEncrypted`. Reserved for
   *  `IntegrationsService.getDecryptedTenantSecret`, the only method allowed to decrypt a tenant
   *  account's credential (Stage 2.4). Never call this from any read-only/lookup path a resolver
   *  can reach directly. */
  findByIdForOrganizationWithSecret(
    id: string,
    organizationId: string,
  ): Promise<IntegrationAccountDocument | null> {
    if (
      !Types.ObjectId.isValid(id) ||
      !Types.ObjectId.isValid(organizationId)
    ) {
      return Promise.resolve(null);
    }
    return this.model
      .findOne({
        _id: id,
        scope: 'tenant',
        organizationId: new Types.ObjectId(organizationId),
      })
      .select('+secretEncrypted')
      .exec();
  }

  listByOrganization(
    organizationId: string,
    domain?: IntegrationDomain,
  ): Promise<IntegrationAccountDocument[]> {
    if (!Types.ObjectId.isValid(organizationId)) return Promise.resolve([]);
    const filter: Record<string, unknown> = {
      scope: 'tenant',
      organizationId: new Types.ObjectId(organizationId),
    };
    if (domain) filter.domain = domain;
    return this.model.find(filter).sort({ createdAt: -1 }).exec();
  }

  listPlatformAccounts(
    domain?: IntegrationDomain,
  ): Promise<IntegrationAccountDocument[]> {
    const filter: Record<string, unknown> = { scope: 'platform' };
    if (domain) filter.domain = domain;
    return this.model.find(filter).sort({ createdAt: -1 }).exec();
  }

  async updateStatus(
    id: string,
    status: IntegrationAccountStatus,
    extra?: {
      lastVerifiedAt?: Date | null;
      lastErrorAt?: Date | null;
      lastErrorMessage?: string | null;
    },
  ): Promise<void> {
    await this.model.updateOne({ _id: id }, { status, ...extra }).exec();
  }

  /** Revocation is a status update, never a delete — see architecture doc §3. Also clears
   *  `isLive` so the row stops occupying its uniqueness slot in `uniq_platform_account` /
   *  `uniq_tenant_account` (see integration-account.schema.ts's doc comment on that field for
   *  why `status: 'revoked'` alone can't be the partial-index filter). */
  /** Puts a row back into (or out of) its uniqueness slot — see rotatePlatformAccountSecret. */
  async setLive(
    id: string,
    isLive: boolean,
    status?: IntegrationAccountStatus,
  ): Promise<void> {
    await this.model
      .updateOne({ _id: id }, { isLive, ...(status ? { status } : {}) })
      .exec();
  }

  async revoke(id: string): Promise<void> {
    await this.model
      .updateOne({ _id: id }, { status: 'revoked', isLive: false })
      .exec();
  }

  /**
   * Stage 2.5 — cross-tenant BY NECESSITY, mirroring
   * PaymentsRepository.findOrganizationIdByProviderReference's own reasoning: a verified
   * 360dialog webhook arrives with no tenant/JWT context at all (see
   * three-sixty-dialog-webhook.controller.ts), so this is how its own WABA id
   * (`entry[0].id` in the Meta-shaped payload) maps back to the tenant that connected it.
   * `metadata.wabaId` already stores this exact value at connect time
   * (IntegrationsController.connectMessaging) — queried by dot-path directly on the existing
   * `Object`-typed `metadata` field, no schema change needed. Scoped to `isLive: true` so a
   * revoked/rotated-out account can never resurrect its old tenant attribution for a later
   * webhook delivery (the same rotation-safety reasoning as `uniq_tenant_account`'s partial
   * index — see integration-account.schema.ts).
   */
  findTenantAccountByWabaId(
    wabaId: string,
  ): Promise<IntegrationAccountDocument | null> {
    return this.model
      .findOne({
        scope: 'tenant',
        domain: 'messaging',
        provider: '360dialog',
        isLive: true,
        'metadata.wabaId': wabaId,
      })
      .exec();
  }

  // -- IntegrationAccountsReader -------------------------------------------------------------

  async findPlatformAccount(input: {
    domain: IntegrationDomain;
    role: string;
    market: string | null;
  }): Promise<IntegrationAccountRecord | null> {
    const doc = await this.model
      .findOne({
        scope: 'platform',
        domain: input.domain,
        role: input.role,
        market: input.market,
      })
      .exec();
    return doc ? toIntegrationAccountRecord(doc) : null;
  }

  async findTenantAccount(input: {
    organizationId: string;
    domain: IntegrationDomain;
    provider: string;
  }): Promise<IntegrationAccountRecord | null> {
    if (!Types.ObjectId.isValid(input.organizationId)) return null;
    const doc = await this.model
      .findOne({
        scope: 'tenant',
        organizationId: new Types.ObjectId(input.organizationId),
        domain: input.domain,
        provider: input.provider,
      })
      .exec();
    return doc ? toIntegrationAccountRecord(doc) : null;
  }
}

/** Secret-free projection shared by every read path — see IntegrationAccountRecord's own doc
 *  comment in integrations.types.ts for why this shape can never carry a credential. */
export function toIntegrationAccountRecord(
  doc: Pick<
    IntegrationAccountDocument,
    | '_id'
    | 'scope'
    | 'organizationId'
    | 'domain'
    | 'provider'
    | 'role'
    | 'market'
    | 'status'
    | 'metadata'
    | 'lastVerifiedAt'
    | 'lastErrorAt'
    | 'lastErrorMessage'
  >,
): IntegrationAccountRecord {
  return {
    id: String(doc._id),
    scope: doc.scope,
    organizationId: doc.organizationId ? String(doc.organizationId) : null,
    domain: doc.domain,
    provider: doc.provider,
    role: doc.role,
    market: doc.market,
    status: doc.status,
    metadata: doc.metadata,
    lastVerifiedAt: doc.lastVerifiedAt,
    lastErrorAt: doc.lastErrorAt,
    lastErrorMessage: doc.lastErrorMessage,
  };
}
