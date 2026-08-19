import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { idToJson } from '../../core/mongoose/schema-options';

export type UserDocument = HydratedDocument<User>;

@Schema({ timestamps: true, collection: 'users', toJSON: idToJson })
export class User {
  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  })
  email!: string;

  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop()
  firstName?: string;

  @Prop()
  lastName?: string;

  @Prop({ type: Date, default: null })
  emailVerifiedAt!: Date | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
