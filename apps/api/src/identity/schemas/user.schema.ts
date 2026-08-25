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

  /**
   * TOTP secret, AES-256-GCM encrypted at rest (see two-factor.service.ts's `encryptSecret`) —
   * never the raw base32 secret, and never selected by default so it can only ever leave
   * MongoDB via an explicit `.select('+totpSecretEncrypted')`, the same posture as
   * `passwordHash` above. Set only once TOTP has actually been confirmed (see `totpEnabled`);
   * before confirmation the candidate secret lives in `totpPendingSecretEncrypted` instead, so
   * an abandoned enrollment can never silently arm 2FA on an account.
   */
  @Prop({ type: String, select: false, default: null })
  totpSecretEncrypted!: string | null;

  @Prop({ type: String, select: false, default: null })
  totpPendingSecretEncrypted!: string | null;

  @Prop({ default: false })
  totpEnabled!: boolean;

  /**
   * Consecutive failed login attempts since the last successful login or the last unlock —
   * reset to 0 on either. See AuthService.login's lockout logic.
   */
  @Prop({ default: 0 })
  failedLoginAttempts!: number;

  /** Set once failedLoginAttempts crosses the lockout threshold; cleared on a successful login. */
  @Prop({ type: Date, default: null })
  lockedUntil!: Date | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
