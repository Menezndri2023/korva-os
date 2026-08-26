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
}

export const ContactSchema = SchemaFactory.createForClass(Contact);
ContactSchema.index({ organizationId: 1, email: 1 });
ContactSchema.index({ organizationId: 1, createdAt: -1 });
ContactSchema.index({ organizationId: 1, tags: 1 });
ContactSchema.index({
  organizationId: 1,
  firstName: 'text',
  lastName: 'text',
  company: 'text',
  email: 'text',
});
