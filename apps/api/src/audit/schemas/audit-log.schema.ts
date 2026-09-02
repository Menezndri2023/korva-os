import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { AUDIT_ACTIONS, type AuditAction } from '@korva/types';
import { idToJson } from '../../core/mongoose/schema-options';

export type AuditLogDocument = HydratedDocument<AuditLog>;
export { AUDIT_ACTIONS };
export type { AuditAction };

@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'audit_logs',
  toJSON: idToJson,
})
export class AuditLog {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: false, index: true })
  userId?: Types.ObjectId;

  @Prop({ type: String, enum: AUDIT_ACTIONS, required: true })
  action!: AuditAction;

  @Prop({ required: true })
  entity!: string;

  @Prop()
  entityId?: string;

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ organizationId: 1, createdAt: -1 });
