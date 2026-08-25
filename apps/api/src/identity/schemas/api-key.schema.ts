import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../core/mongoose/schema-options';

export type ApiKeyDocument = HydratedDocument<ApiKey>;

/**
 * A server-to-server credential scoped to one organization and tied to one Role — it carries
 * exactly the permissions a human member with that role would have (see
 * ApiKeyGuard.canActivate, which resolves the role the same way MembershipsService.
 * resolveTenantContext does for a JWT session). Same secret-storage pattern as
 * PasswordResetToken/Invitation: only a SHA-256 hash of the plaintext key is ever persisted
 * (keyHash, select: false, see token-hash.util.ts) — the plaintext itself is generated once (see
 * api-key-generator.util.ts), returned once in the create/rotate response body, and never
 * stored or logged anywhere again. `keyPrefix` is NOT sensitive — it is only the first several
 * characters of the plaintext (e.g. "korva_live_ab12cd34"), kept so a listing UI can help an
 * operator recognize which key is which without ever re-displaying the secret.
 *
 * Revocation is soft (`revokedAt`) rather than a hard delete, so a revoked key keeps showing up
 * in listings/audit history instead of silently disappearing — same posture as
 * Session.revokedAt (logout) elsewhere in this codebase.
 */
@Schema({ timestamps: true, collection: 'api_keys', toJSON: idToJson })
export class ApiKey {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, unique: true, select: false })
  keyHash!: string;

  @Prop({ required: true })
  keyPrefix!: string;

  @Prop({ type: Types.ObjectId, ref: 'Role', required: true })
  roleId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdByUserId!: Types.ObjectId;

  @Prop({ type: Date, default: null })
  lastUsedAt!: Date | null;

  @Prop({ type: Date, default: null })
  expiresAt!: Date | null;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  /** Set on the newly-issued key when it was created by rotating an older one — lineage only,
   *  never consulted for authentication itself. */
  @Prop({ type: Types.ObjectId, ref: 'ApiKey', default: null })
  rotatedFromKeyId!: Types.ObjectId | null;
}

export const ApiKeySchema = SchemaFactory.createForClass(ApiKey);
ApiKeySchema.index({ organizationId: 1, revokedAt: 1 });
