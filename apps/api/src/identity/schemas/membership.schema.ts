import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { MembershipStatus } from '@korva/types';
import { MEMBERSHIP_STATUSES } from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type MembershipDocument = HydratedDocument<Membership>;

@Schema({ timestamps: true, collection: 'memberships', toJSON: idToJson })
export class Membership {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Role', required: true })
  roleId!: Types.ObjectId;

  @Prop({ type: String, enum: MEMBERSHIP_STATUSES, default: 'active' })
  status!: MembershipStatus;

  /** See Membership.defaultHourlyRate in @korva/types for the field-level rationale. */
  @Prop()
  defaultHourlyRate?: number;

  /** See Membership.commissionRateBasisPoints in @korva/types for the field-level rationale. */
  @Prop()
  commissionRateBasisPoints?: number;
}

export const MembershipSchema = SchemaFactory.createForClass(Membership);
MembershipSchema.index({ userId: 1, organizationId: 1 }, { unique: true });
