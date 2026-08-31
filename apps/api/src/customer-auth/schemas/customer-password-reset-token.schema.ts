import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../core/mongoose/schema-options';

export type CustomerPasswordResetTokenDocument =
  HydratedDocument<CustomerPasswordResetToken>;

/**
 * Mirrors PasswordResetToken exactly (at most one row per account — a new forgot-password
 * request replaces any previous row, invalidating it), scoped to a CustomerAccount instead of
 * a global User. The token itself is never stored, only its SHA-256 hash (see token-hash.util.ts).
 */
@Schema({
  timestamps: true,
  collection: 'customer_password_reset_tokens',
  toJSON: idToJson,
})
export class CustomerPasswordResetToken {
  @Prop({
    type: Types.ObjectId,
    ref: 'CustomerAccount',
    required: true,
    unique: true,
  })
  customerAccountId!: Types.ObjectId;

  @Prop({ required: true, index: true, select: false })
  tokenHash!: string;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  usedAt!: Date | null;
}

export const CustomerPasswordResetTokenSchema = SchemaFactory.createForClass(
  CustomerPasswordResetToken,
);
