import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type {
  CustomFieldValues,
  TicketPriority,
  TicketStatus,
} from '@korva/types';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type TicketDocument = HydratedDocument<Ticket>;

@Schema({ timestamps: true, collection: 'tickets', toJSON: idToJson })
export class Ticket {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  subject!: string;

  @Prop()
  description?: string;

  @Prop({ type: String, enum: TICKET_STATUSES, default: 'open' })
  status!: TicketStatus;

  @Prop({ type: String, enum: TICKET_PRIORITIES, default: 'medium' })
  priority!: TicketPriority;

  @Prop({ type: Types.ObjectId, ref: 'Contact', required: true })
  contactId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Conversation' })
  conversationId?: Types.ObjectId;

  /** ref: 'Membership' — the established staff-assignment convention (Booking.staffMembershipId,
   *  Resource.membershipId), not Task's ref:'User' anti-pattern. */
  @Prop({ type: Types.ObjectId, ref: 'Membership' })
  assigneeMembershipId?: Types.ObjectId;

  @Prop({ type: Object, default: {} })
  customFields!: CustomFieldValues;

  @Prop()
  resolvedAt?: Date;

  @Prop()
  closedAt?: Date;
}

export const TicketSchema = SchemaFactory.createForClass(Ticket);
TicketSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
TicketSchema.index({ organizationId: 1, assigneeMembershipId: 1, status: 1 });
TicketSchema.index({ organizationId: 1, contactId: 1 });
