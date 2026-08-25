import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Invitation, InvitationDocument } from '../schemas/invitation.schema';

@Injectable()
export class InvitationsRepository {
  constructor(
    @InjectModel(Invitation.name)
    private readonly invitationModel: Model<InvitationDocument>,
  ) {}

  create(data: {
    organizationId: Types.ObjectId;
    email: string;
    roleId: Types.ObjectId;
    invitedByUserId: Types.ObjectId;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<InvitationDocument> {
    return this.invitationModel.create(data);
  }

  /** Read-only lookup by token — never mutates. Used to give the accept flow a fast, honest
   *  "invalid or expired" response before doing any user/membership work (see
   *  InvitationsService.accept). The actual single-use guarantee is `consume`, not this. */
  findValidByTokenHash(tokenHash: string): Promise<InvitationDocument | null> {
    return this.invitationModel
      .findOne({
        tokenHash,
        status: 'pending',
        expiresAt: { $gt: new Date() },
      })
      .exec();
  }

  /**
   * Atomically flips a still-pending, unexpired invitation to 'accepted' in one MongoDB write —
   * the single source of truth for single-use, exactly the same accept/reject-by-filter pattern
   * as PasswordResetRepository.consume/EmailVerificationRepository.consume. Two concurrent
   * accept calls for the same token can never both succeed: only one findOneAndUpdate matches
   * the still-pending document, the other gets null and must be treated as an invalid/expired/
   * already-used token.
   */
  consume(
    tokenHash: string,
    acceptedByUserId: Types.ObjectId,
  ): Promise<InvitationDocument | null> {
    return this.invitationModel
      .findOneAndUpdate(
        { tokenHash, status: 'pending', expiresAt: { $gt: new Date() } },
        {
          $set: {
            status: 'accepted',
            acceptedAt: new Date(),
            acceptedByUserId,
          },
        },
        { new: true },
      )
      .exec();
  }

  listPendingForOrganization(
    organizationId: string,
  ): Promise<InvitationDocument[]> {
    return this.invitationModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        status: 'pending',
      })
      .exec();
  }
}
