import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  PAYOUT_FREQUENCIES,
  type PayoutFrequency,
  type PayoutProvider,
} from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';
import { PayoutDestinationSchema } from './payout.schema';

export type WalletSettingsDocument = HydratedDocument<WalletSettings>;

const PendingDestinationSchema = new MongooseSchema(
  {
    provider: { type: String, required: true },
    account: { type: String, required: true },
    holderName: { type: String, required: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
  },
  { _id: false },
);

/**
 * Where and when a business is paid. A new withdrawal number only takes effect once the 6-digit
 * code e-mailed to the person who entered it is confirmed — a stolen session cannot silently
 * redirect a business's money — and automatic withdrawals wait DESTINATION_COOLDOWN after a change.
 */
@Schema({ timestamps: true, collection: 'wallet_settings', toJSON: idToJson })
export class WalletSettings {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    unique: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: PayoutDestinationSchema })
  destination?: {
    provider: PayoutProvider;
    account: string;
    holderName: string;
  };

  @Prop()
  destinationConfirmedAt?: Date;

  @Prop({ type: PendingDestinationSchema })
  pendingDestination?: {
    provider: PayoutProvider;
    account: string;
    holderName: string;
    codeHash: string;
    expiresAt: Date;
    attempts: number;
  };

  @Prop({ default: false })
  autoPayoutEnabled!: boolean;

  @Prop({ type: String, enum: PAYOUT_FREQUENCIES, default: 'weekly' })
  autoPayoutFrequency!: PayoutFrequency;

  @Prop({ default: 5000 })
  autoPayoutMinimum!: number;

  @Prop()
  lastAutoPayoutAt?: Date;
}

export const WalletSettingsSchema =
  SchemaFactory.createForClass(WalletSettings);
