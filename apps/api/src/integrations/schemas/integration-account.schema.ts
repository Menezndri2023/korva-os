import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../core/mongoose/schema-options';
import type {
  IntegrationAccountStatus,
  IntegrationDomain,
  IntegrationScope,
} from '../integrations.types';

export type IntegrationAccountDocument = HydratedDocument<IntegrationAccount>;

/**
 * See docs/architecture/integrations-platform.md §2 — one collection for both KORVA's own
 * ("platform") provider credentials and each tenant's connected account/payout destination
 * ("tenant"), disambiguated by `scope`.
 *
 * `organizationId` is required iff `scope === 'tenant'` and forbidden iff `scope === 'platform'`
 * — enforced app-side in IntegrationsService (which is the only writer of this collection),
 * rather than as a Mongoose conditional-required rule, mirroring how this codebase generally
 * prefers explicit service-level invariants over cross-field schema validators.
 *
 * `secretEncrypted` is `select: false`, same posture as `ApiKey.keyHash` and
 * `User.totpSecretEncrypted` — a plain `find()`/`findOne()` never returns it, so leaking it
 * requires a caller to explicitly opt in with `.select('+secretEncrypted')` (see
 * IntegrationsRepository.findByIdWithSecret, the only place that does).
 */
@Schema({
  timestamps: true,
  collection: 'integration_accounts',
  toJSON: idToJson,
})
export class IntegrationAccount {
  @Prop({ required: true, enum: ['platform', 'tenant'], index: true })
  scope!: IntegrationScope;

  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    default: null,
    index: true,
  })
  organizationId!: Types.ObjectId | null;

  @Prop({ required: true, enum: ['payment', 'messaging'], index: true })
  domain!: IntegrationDomain;

  @Prop({ required: true, trim: true })
  provider!: string;

  /** Disambiguates multiple platform accounts in the same domain (e.g. 'subscription-billing'
   *  vs 'merchant-of-record'). Present but not load-bearing for tenant-scope rows. */
  @Prop({ required: true, trim: true })
  role!: string;

  /** ISO country code ('CI' | 'MA' | ...) or null for a market-independent account. */
  @Prop({ type: String, default: null })
  market!: string | null;

  @Prop({
    required: true,
    enum: ['pending', 'active', 'disabled', 'revoked', 'error'],
    default: 'pending',
    index: true,
  })
  status!: IntegrationAccountStatus;

  /** AES-256-GCM ciphertext, `iv:authTag:ciphertext` hex (see CredentialEncryptionService).
   *  Absent entirely (`null`) for records that hold no bearer secret of their own — e.g. a
   *  tenant's WhatsApp WABA authenticated via the platform BSP-partner key. Never selected by
   *  default; see class doc above. */
  @Prop({ type: String, default: null, select: false })
  secretEncrypted!: string | null;

  /** NON-secret only — subaccountId, wabaId, phoneNumberId, displayName, webhookConfigId,
   *  environment, payoutDestination, etc. Never a bearer secret (see architecture doc §2). */
  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;

  @Prop({ type: Date, default: null })
  lastVerifiedAt!: Date | null;

  @Prop({ type: Date, default: null })
  lastErrorAt!: Date | null;

  @Prop({ type: String, default: null })
  lastErrorMessage!: string | null;

  /** True for every row until it's revoked, then flipped to false — exists only so the two
   *  partial unique indexes below can filter on a plain `$eq`. MongoDB's partial-index filter
   *  language does not support `$ne`/`$not` (confirmed against a real server: `syncIndexes()`
   *  throws "Expression not supported in partial index: $not" for a `status: {$ne:'revoked'}`
   *  filter) — `isLive` exists purely to make "exclude revoked rows" expressible as `$eq`, it
   *  carries no meaning beyond that and is never read anywhere except by these two indexes. */
  @Prop({ type: Boolean, default: true, index: true })
  isLive!: boolean;
}

export const IntegrationAccountSchema =
  SchemaFactory.createForClass(IntegrationAccount);

// One *live* platform-scope row per (domain, provider, market, role) combination — lets the
// resolver (§4/§5 of the architecture doc) address a single unambiguous KORVA-owned credential.
// The partial filter excludes revoked rows via `isLive: true` (a plain $eq — see the field's own
// doc comment for why this isn't just `status: {$ne:'revoked'}`, which MongoDB's partial-index
// filter language rejects outright): §3's rotation contract ("insert new + mark old
// status:'revoked', keep both, no deletion") inserts a second row sharing the same
// (domain, provider, market, role) as the one it replaces, which would violate a uniqueness
// constraint keyed on those fields alone the instant a rotation happened. Excluding revoked rows
// keeps the invariant the doc actually wants — at most one live row per combination — while still
// allowing unlimited revoked rows to accumulate for audit history.
IntegrationAccountSchema.index(
  { scope: 1, domain: 1, provider: 1, market: 1, role: 1 },
  {
    unique: true,
    partialFilterExpression: { scope: 'platform', isLive: true },
    name: 'uniq_platform_account',
  },
);

// One *live* tenant-scope row per (organizationId, domain, provider) combination — a tenant
// connects at most one live account per provider per domain. Same isLive rationale as
// uniq_platform_account above, required for rotation to be possible at all.
IntegrationAccountSchema.index(
  { organizationId: 1, domain: 1, provider: 1 },
  {
    unique: true,
    partialFilterExpression: { scope: 'tenant', isLive: true },
    name: 'uniq_tenant_account',
  },
);
