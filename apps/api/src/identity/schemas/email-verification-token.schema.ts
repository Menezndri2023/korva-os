import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../core/mongoose/schema-options';

export type EmailVerificationTokenDocument =
  HydratedDocument<EmailVerificationToken>;

/**
 * At most one row per user — a new verification request replaces (upserts over) any previous
 * row for the same userId, invalidating a previously-issued, still-unused token. Deliberately a
 * separate collection from PasswordResetToken (same shape/pattern, not the same storage) — the
 * two are different sensitive operations, and coupling them would let a bug in one silently
 * affect the other. The token itself is never stored: only its SHA-256 hash (tokenHash, see
 * token-hash.util.ts), the same pattern already used for refresh tokens and password reset.
 */
@Schema({
  timestamps: true,
  collection: 'email_verification_tokens',
  toJSON: idToJson,
})
export class EmailVerificationToken {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, index: true, select: false })
  tokenHash!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  usedAt!: Date | null;
}

export const EmailVerificationTokenSchema = SchemaFactory.createForClass(
  EmailVerificationToken,
);
