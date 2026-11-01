import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PlatformNoteDocument = HydratedDocument<PlatformNote>;

/**
 * An administrator's internal note on a business ("appelée le 30 oct., veut son domaine") —
 * never shown to the business. Append-only: a note is a record of what was said or done.
 */
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'platform_notes',
})
export class PlatformNote {
  @Prop({ type: Types.ObjectId, ref: 'Organization', required: true })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, maxlength: 2000 })
  text!: string;

  @Prop({ required: true })
  authorEmail!: string;
}

export const PlatformNoteSchema = SchemaFactory.createForClass(PlatformNote);

PlatformNoteSchema.index({ organizationId: 1, createdAt: -1 });
