import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PlatformAdminDocument = HydratedDocument<PlatformAdmin>;

/**
 * A member of KORVA's own administration — deliberately NOT a User. A User belongs to
 * businesses (memberships, roles, an onboarding); an administrator runs the platform and has no
 * business of their own. Keeping them apart means an administrator never appears among the
 * platform's customers, and a stolen tenant session can never reach the administration.
 *
 * Created by the operator on the server (dist/create-platform-admin.js), never through a web
 * form, and only for an address listed in PLATFORM_ADMIN_EMAILS.
 */
@Schema({ timestamps: true, collection: 'platform_admins' })
export class PlatformAdmin {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  /** argon2. The password itself is never stored, logged or returned. */
  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ default: 0 })
  failedLoginAttempts!: number;

  @Prop({ type: Date, default: null })
  lockedUntil!: Date | null;

  @Prop({ type: Date, default: null })
  lastLoginAt!: Date | null;

  @Prop({ type: Date, default: null })
  passwordChangedAt!: Date | null;
}

export const PlatformAdminSchema = SchemaFactory.createForClass(PlatformAdmin);
