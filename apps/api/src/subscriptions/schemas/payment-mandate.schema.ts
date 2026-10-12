import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../core/mongoose/schema-options';

export type PaymentMandateDocument = HydratedDocument<PaymentMandate>;

/**
 * A reusable payment authorization captured for one organization, so KORVA can charge its own
 * SaaS invoices without the payer present (Paystack's `authorization_code`, Flutterwave's
 * saved-card `token`).
 *
 * `referenceEncrypted` holds the authorization under the same AES-256-GCM key
 * (INTEGRATION_CREDENTIALS_KEY, via CredentialEncryptionService) that protects stored PSP
 * credentials, and is `select: false` so no query returns it unless it is asked for by name.
 * That is not belt-and-braces: a leaked authorization code lets a third party charge the card it
 * belongs to through the same provider account, so it is a credential, not an identifier.
 *
 * One active mandate per (organization, provider). Deliberately keyed by provider too: a
 * Paystack authorization is meaningless to Flutterwave, so switching the platform's
 * subscription-billing provider must not silently reuse the old one.
 */
@Schema({ timestamps: true, collection: 'payment_mandates', toJSON: idToJson })
export class PaymentMandate {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  /** Provider key as registered in PaymentProviderRegistry ('paystack', 'flutterwave', ...). */
  @Prop({ required: true })
  provider!: string;

  @Prop({ required: true, select: false })
  referenceEncrypted!: string;

  /** The email the authorization was created under. Both providers reject a charge whose email
   *  does not match the one the authorization belongs to, so this travels with the mandate
   *  rather than being re-derived from whoever happens to trigger a renewal. */
  @Prop({ required: true })
  payerEmail!: string;

  /** Cleared mandates are kept, not deleted: a revoked authorization is useful history when
   *  reconciling why a renewal fell back to an invoice. */
  @Prop({ type: Boolean, default: true })
  active!: boolean;

  @Prop({ type: Date, default: null })
  lastUsedAt!: Date | null;

  /** Why the mandate stopped being usable — set alongside active:false. */
  @Prop({ type: String, default: null })
  revokedReason!: string | null;
}

export const PaymentMandateSchema =
  SchemaFactory.createForClass(PaymentMandate);

/**
 * One mandate per (organization, provider), enforced rather than merely intended: capturing a
 * second authorization for the same pair must replace the first, never leave two rows where a
 * renewal would pick arbitrarily between them.
 */
PaymentMandateSchema.index(
  { organizationId: 1, provider: 1 },
  { unique: true },
);
