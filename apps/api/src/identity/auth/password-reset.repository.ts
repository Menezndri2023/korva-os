import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PasswordResetToken,
  PasswordResetTokenDocument,
} from '../schemas/password-reset-token.schema';

@Injectable()
export class PasswordResetRepository {
  constructor(
    @InjectModel(PasswordResetToken.name)
    private readonly tokenModel: Model<PasswordResetTokenDocument>,
  ) {}

  /**
   * Replaces any existing reset token for this user with a fresh one — the unique index on
   * userId means only one row can ever exist per user, so issuing a new token implicitly
   * invalidates whichever one preceded it (see PasswordResetToken's class doc).
   *
   * Two concurrent forgot-password requests for the SAME user, racing to insert their
   * first-ever row, can both attempt an insert; MongoDB lets exactly one through and E11000s
   * the other on the unique userId index — the same race WorkflowsRepository.claimAction
   * already handles for its own unique index. The loser simply retries as a plain update: by
   * the time it retries, the winner's row definitely exists, so no further upsert/insert
   * branch is needed. An unconditional upsert alone (without this fallback) would let that
   * race surface as an unhandled 500 instead of the request quietly succeeding either way.
   */
  async issue(
    userId: Types.ObjectId,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    try {
      await this.tokenModel.findOneAndUpdate(
        { userId },
        { $set: { tokenHash, expiresAt, usedAt: null } },
        { upsert: true },
      );
    } catch (error) {
      if (!isDuplicateUserIdError(error)) throw error;
      await this.tokenModel.updateOne(
        { userId },
        { $set: { tokenHash, expiresAt, usedAt: null } },
      );
    }
  }

  /**
   * Atomically finds-and-consumes a still-valid (unused, unexpired) token in one MongoDB
   * write — the same accept/reject-by-filter pattern as
   * SessionsRepository.revokeActiveByTokenHash. Two concurrent reset-password calls
   * presenting the same token can never both match: only one findOneAndUpdate wins the
   * document, the other gets null back and must be treated identically to an
   * invalid/expired/already-used token by the caller (see PasswordResetService.resetPassword).
   */
  consume(tokenHash: string): Promise<PasswordResetTokenDocument | null> {
    return this.tokenModel
      .findOneAndUpdate(
        { tokenHash, usedAt: null, expiresAt: { $gt: new Date() } },
        { $set: { usedAt: new Date() } },
        { new: true },
      )
      .exec();
  }
}

/**
 * True for the MongoDB duplicate-key error (code 11000) raised by the unique index on
 * userId — mirrors isDuplicateActionClaimError (WorkflowsRepository) and
 * isDuplicateIdempotencyKeyError (PaymentsService), narrowed by index field name so an
 * unrelated unique-index collision is never silently treated as this specific race.
 */
function isDuplicateUserIdError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as Record<string, unknown>;
  return (
    code === 11000 && typeof message === 'string' && message.includes('userId')
  );
}
