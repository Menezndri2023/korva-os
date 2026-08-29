import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type {
  ConsentChannel,
  ContactConsent,
  ContactType,
  CustomFieldValues,
} from '@korva/types';
import { CONSENT_CHANNELS, CONTACT_TYPES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type ContactDocument = HydratedDocument<Contact>;

/** See ContactConsent in @korva/types for the field-level rationale — this is its Mongoose
 *  sub-document shape, kept in sync by hand since it's small and stable. */
@Schema({ _id: false })
export class ContactConsentSubdocument implements ContactConsent {
  @Prop({ type: String, enum: CONSENT_CHANNELS, required: true })
  channel!: ConsentChannel;

  @Prop({ type: Date, required: true })
  grantedAt!: string;

  @Prop({ type: String, required: true })
  source!: string;

  @Prop({ type: Date })
  revokedAt?: string;
}

export const ContactConsentSchema = SchemaFactory.createForClass(
  ContactConsentSubdocument,
);

@Schema({ timestamps: true, collection: 'contacts', toJSON: idToJson })
export class Contact {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: String, enum: CONTACT_TYPES, default: 'person' })
  type!: ContactType;

  @Prop()
  firstName?: string;

  @Prop()
  lastName?: string;

  @Prop()
  company?: string;

  @Prop({ lowercase: true, trim: true })
  email?: string;

  @Prop()
  phone?: string;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop({ type: Object, default: {} })
  customFields!: CustomFieldValues;

  @Prop({ type: [ContactConsentSchema], default: [] })
  consents!: ContactConsent[];

  /**
   * Set by CustomerInactivitySchedulerService when it publishes `customer.inactive` for this
   * contact — not a status field, just a dedup marker so the same inactivity episode isn't
   * re-published on every sweep tick. Compared against the contact's dynamically-computed last
   * activity timestamp (not stored anywhere — derived from Quote/Invoice/Booking/Order/
   * Conversation): a contact is eligible again once `inactiveNotifiedAt` predates that
   * timestamp, which only becomes true after new activity moves it forward. Absent for every
   * contact that has never (yet) gone through an inactivity episode.
   */
  @Prop({ type: Date })
  inactiveNotifiedAt?: Date;
}

export const ContactSchema = SchemaFactory.createForClass(Contact);
ContactSchema.index({ organizationId: 1, email: 1 });
ContactSchema.index({ organizationId: 1, createdAt: -1 });
ContactSchema.index({ organizationId: 1, tags: 1 });
// Supports CustomerInactivitySchedulerService's global sweep (no organizationId in its query —
// same cross-tenant-background-job shape as quote-expiry/invoice-overdue's own schedulers):
// shrinks the candidate set to contacts old enough to possibly be inactive and not already
// notified inside the current threshold window, before the per-contact activity computation.
ContactSchema.index({ createdAt: 1, inactiveNotifiedAt: 1 });
ContactSchema.index({
  organizationId: 1,
  firstName: 'text',
  lastName: 'text',
  company: 'text',
  email: 'text',
});
