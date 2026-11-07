import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../core/mongoose/schema-options';

export type CustomerAccountDocument = HydratedDocument<CustomerAccount>;

/**
 * A login credential for an end customer of one organization's storefront — deliberately a
 * separate collection from Contact, not extra fields on it: Contact has no email-uniqueness
 * constraint and is freely mutable by any staff member via the generic CRM update endpoint,
 * so a passwordHash living there could be silently clobbered by unrelated CRM tooling. This
 * schema only owns the credential; contactId is the join back to the real CRM/order/booking
 * data, same "contact is the customer" principle preserved, just with the auth concern
 * isolated (mirrors why Session was split from User rather than folded into it).
 *
 * A given email can recur across different organizations (each org's CustomerAccount is
 * independent) — the unique index is per-organization, not global.
 */
@Schema({
  timestamps: true,
  collection: 'customer_accounts',
  toJSON: idToJson,
})
export class CustomerAccount {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true })
  contactId!: Types.ObjectId;

  @Prop({ required: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ type: Date, default: null })
  emailVerifiedAt!: Date | null;

  /** Consecutive failed login attempts since the last successful login or unlock — same
   *  lockout mechanics as User.failedLoginAttempts (see CustomerAuthService.login). */
  @Prop({ default: 0 })
  failedLoginAttempts!: number;

  @Prop({ type: Date, default: null })
  lockedUntil!: Date | null;

  /** Set by the business (Clients › Espaces clients): sign-in refused and sessions ended until it
   *  turns it back on. Nothing of the customer's history is touched. */
  @Prop({ type: Date, default: null })
  disabledAt!: Date | null;

  /** Last successful sign-in, shown to the business. */
  @Prop({ type: Date, default: null })
  lastLoginAt!: Date | null;

  /** The shop basket and the lines put aside, kept with the account so they follow the customer
   *  from one phone or computer to another. Prices are only a reminder: the order always
   *  re-reads them from the offers. */
  @Prop({ type: Object, default: undefined })
  basket?: { cart: unknown[]; saved: unknown[]; updatedAt: Date };
}

export const CustomerAccountSchema =
  SchemaFactory.createForClass(CustomerAccount);
CustomerAccountSchema.index(
  { organizationId: 1, contactId: 1 },
  { unique: true },
);
CustomerAccountSchema.index({ organizationId: 1, email: 1 }, { unique: true });
