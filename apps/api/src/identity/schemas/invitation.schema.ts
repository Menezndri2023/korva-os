import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { idToJson } from '../../core/mongoose/schema-options';

export type InvitationDocument = HydratedDocument<Invitation>;

export const INVITATION_STATUSES = ['pending', 'accepted'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/**
 * A single-use, time-limited invitation for `email` to join `organizationId` with `roleId`.
 * Deliberately its own collection (own file, per this lot's file-ownership constraints — see
 * OrganizationsService.addMember, the pre-existing "email must already have a KORVA account"
 * path this lot adds an alternative to) rather than a new field on Organization or Membership.
 * The token itself is never stored, only its SHA-256 hash (tokenHash, see token-hash.util.ts) —
 * same pattern as PasswordResetToken/EmailVerificationToken. A row is never deleted: `status`
 * plus `expiresAt` fully describe its lifecycle, and `acceptedByUserId`/`acceptedAt` are the
 * audit trail of who actually consumed it (see InvitationsRepository.consume).
 */
@Schema({ timestamps: true, collection: 'invitations', toJSON: idToJson })
export class Invitation {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ required: true, lowercase: true, trim: true, index: true })
  email!: string;

  @Prop({ type: Types.ObjectId, ref: 'Role', required: true })
  roleId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  invitedByUserId!: Types.ObjectId;

  @Prop({ required: true, index: true, select: false })
  tokenHash!: string;

  @Prop({ type: String, enum: INVITATION_STATUSES, default: 'pending' })
  status!: InvitationStatus;

  @Prop({ required: true })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  acceptedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  acceptedByUserId!: Types.ObjectId | null;
}

export const InvitationSchema = SchemaFactory.createForClass(Invitation);
