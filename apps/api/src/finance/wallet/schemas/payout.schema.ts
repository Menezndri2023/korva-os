import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  PAYOUT_PROVIDERS,
  PAYOUT_STATUSES,
  type PayoutProvider,
  type PayoutStatus,
} from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type PayoutDocument = HydratedDocument<Payout>;

export const PayoutDestinationSchema = new MongooseSchema(
  {
    provider: { type: String, enum: PAYOUT_PROVIDERS, required: true },
    account: { type: String, required: true },
    holderName: { type: String, required: true },
  },
  { _id: false },
);

/**
 * A withdrawal from a business's Solde KORVA to its mobile money account, sent through
 * GeniusPay's Payout API. Its amount is taken off the balance when it is REQUESTED (a "payout"
 * ledger line) and given back if it fails or is refused (a "payout_reversal" line).
 *
 * `open` is true while requested/processing and unset afterwards; the partial unique index on it
 * allows ONE open withdrawal per business at a time — two simultaneous requests cannot both draw
 * on the same balance.
 */
@Schema({ timestamps: true, collection: 'payouts', toJSON: idToJson })
export class Payout {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  amount!: number;

  /** GeniusPay's own withdrawal fee, once it says it. */
  @Prop()
  fee?: number;

  @Prop({ required: true })
  currency!: string;

  @Prop({ type: String, enum: PAYOUT_STATUSES, required: true })
  status!: PayoutStatus;

  @Prop()
  open?: boolean;

  @Prop({ type: String, enum: ['manual', 'auto'], required: true })
  trigger!: 'manual' | 'auto';

  @Prop({ type: PayoutDestinationSchema, required: true })
  destination!: {
    provider: PayoutProvider;
    account: string;
    holderName: string;
  };

  @Prop()
  providerReference?: string;

  @Prop()
  failureReason?: string;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  requestedBy?: Types.ObjectId;

  @Prop()
  approvedAt?: Date;

  @Prop()
  completedAt?: Date;
}

export const PayoutSchema = SchemaFactory.createForClass(Payout);
PayoutSchema.index(
  { organizationId: 1 },
  {
    unique: true,
    partialFilterExpression: { open: true },
    name: 'one_open_payout',
  },
);
PayoutSchema.index({ status: 1, createdAt: 1 });
PayoutSchema.index({ organizationId: 1, createdAt: -1 });
PayoutSchema.index({ providerReference: 1 }, { sparse: true });
