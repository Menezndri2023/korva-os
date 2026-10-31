import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { WALLET_ENTRY_KINDS, type WalletEntryKind } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type WalletEntryDocument = HydratedDocument<WalletEntry>;

/**
 * One line of a business's Solde KORVA. Never updated, never deleted: the balance is the sum of
 * these lines, so every franc can be traced to the sale, fee, commission or withdrawal behind
 * it. `sourceKey` is unique ("sale:<paymentId>", "payout:<payoutId>"…): crediting the same
 * payment twice, from the webhook and the sweep at once, cannot happen.
 */
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'wallet_entries',
  toJSON: idToJson,
})
export class WalletEntry {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ type: String, enum: WALLET_ENTRY_KINDS, required: true })
  kind!: WalletEntryKind;

  /** Signed: + money for the business, − money out of its balance. */
  @Prop({ required: true })
  amount!: number;

  @Prop({ required: true })
  currency!: string;

  /** From when the line counts as withdrawable (a sale: after the safety delay). */
  @Prop({ required: true })
  availableAt!: Date;

  @Prop({ required: true, unique: true })
  sourceKey!: string;

  @Prop({ type: Types.ObjectId, ref: 'Payment' })
  paymentId?: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Payout' })
  payoutId?: Types.ObjectId;

  @Prop()
  note?: string;
}

export const WalletEntrySchema = SchemaFactory.createForClass(WalletEntry);
WalletEntrySchema.index({ organizationId: 1, createdAt: -1 });
WalletEntrySchema.index({ organizationId: 1, availableAt: 1 });
