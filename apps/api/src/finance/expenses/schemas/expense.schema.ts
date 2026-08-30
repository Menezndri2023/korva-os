import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import type { ExpenseStatus } from '@korva/types';
import { EXPENSE_STATUSES } from '@korva/types';
import { idToJson } from '../../../core/mongoose/schema-options';

export type ExpenseDocument = HydratedDocument<Expense>;

@Schema({ timestamps: true, collection: 'expenses', toJSON: idToJson })
export class Expense {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ required: true })
  number!: string;

  @Prop({ type: String, enum: EXPENSE_STATUSES, default: 'recorded' })
  status!: ExpenseStatus;

  @Prop({ required: true })
  category!: string;

  @Prop({ required: true })
  description!: string;

  @Prop({ required: true })
  amount!: number;

  @Prop({ required: true })
  currency!: string;

  @Prop({ required: true })
  date!: Date;

  @Prop()
  vendor?: string;

  /** See Expense.contactId/billable/invoiceId in @korva/types for the field-level rationale. */
  @Prop({ type: Types.ObjectId, ref: 'Contact' })
  contactId?: Types.ObjectId;

  @Prop({ default: false })
  billable!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Invoice' })
  invoiceId?: Types.ObjectId;

  @Prop()
  notes?: string;
}

export const ExpenseSchema = SchemaFactory.createForClass(Expense);
ExpenseSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
ExpenseSchema.index({ organizationId: 1, number: 1 }, { unique: true });
ExpenseSchema.index({ organizationId: 1, contactId: 1, status: 1 });
