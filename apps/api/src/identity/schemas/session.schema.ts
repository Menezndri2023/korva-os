import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../core/mongoose/schema-options';

export type SessionDocument = HydratedDocument<Session>;

/** Tracks issued refresh tokens so they can be individually revoked (logout) and rotated. */
@Schema({ timestamps: true, collection: 'sessions', toJSON: idToJson })
export class Session {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, unique: true, select: false })
  refreshTokenHash!: string;

  @Prop({ required: true, expires: 0 })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop()
  userAgent?: string;

  @Prop()
  ip?: string;
}

export const SessionSchema = SchemaFactory.createForClass(Session);
