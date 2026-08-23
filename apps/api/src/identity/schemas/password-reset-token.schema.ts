import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../core/mongoose/schema-options';

export type PasswordResetTokenDocument = HydratedDocument<PasswordResetToken>;

/**
 * At most one row per user — a new forgot-password request replaces (upserts over) any
 * previous row for the same userId, which is what makes an older, already-emailed token
 * invalid the moment a newer one is requested (see PasswordResetRepository.issue). The
 * token itself is never stored: only its SHA-256 hash (tokenHash, see token-hash.util.ts),
 * the same pattern already used for refresh tokens on Session.refreshTokenHash.
 */
@Schema({ timestamps: true, collection: 'password_reset_tokens', toJSON: idToJson })
export class PasswordResetToken {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, index: true, select: false })
  tokenHash!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  usedAt!: Date | null;
}

export const PasswordResetTokenSchema =
  SchemaFactory.createForClass(PasswordResetToken);
