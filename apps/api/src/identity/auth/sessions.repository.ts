import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Session, SessionDocument } from '../schemas/session.schema';

@Injectable()
export class SessionsRepository {
  constructor(
    @InjectModel(Session.name)
    private readonly sessionModel: Model<SessionDocument>,
  ) {}

  create(data: Partial<Session>): Promise<SessionDocument> {
    return this.sessionModel.create(data);
  }

  /**
   * Atomically finds an active session by hash AND marks it revoked, in a single MongoDB
   * write — the accept/reject decision ("is this token still active") is made by MongoDB
   * itself, in the SAME findOneAndUpdate as the write, via `revokedAt: null` in the filter —
   * not from a value read moments earlier by a separate query. Two concurrent refresh
   * requests presenting the same token can therefore never both match: only one
   * findOneAndUpdate wins the document at a time, mirroring
   * PaymentsRepository.finalizePayment's `requireStatus` guard. The loser gets `null` back and
   * falls into the exact same "not found" path AuthService.refresh already handles
   * (detectRefreshTokenReuse) — no separate race-handling branch needed.
   */
  async revokeActiveByTokenHash(
    refreshTokenHash: string,
  ): Promise<SessionDocument | null> {
    return this.sessionModel
      .findOneAndUpdate(
        {
          refreshTokenHash,
          revokedAt: null,
          expiresAt: { $gt: new Date() },
        },
        { revokedAt: new Date() },
        { new: true },
      )
      .exec();
  }

  /**
   * Looks up a session by hash regardless of revoked/expired status — rotation never deletes
   * a row, it only sets `revokedAt`, so this is what lets the caller tell a *known but
   * already-rotated* token apart from one that never existed at all (see AuthService.refresh's
   * reuse-detection branch).
   */
  findByTokenHash(refreshTokenHash: string): Promise<SessionDocument | null> {
    return this.sessionModel.findOne({ refreshTokenHash }).exec();
  }

  async revokeByTokenHash(refreshTokenHash: string): Promise<void> {
    await this.sessionModel
      .updateOne({ refreshTokenHash }, { revokedAt: new Date() })
      .exec();
  }

  /**
   * Revokes every currently-active session for a user — used when a rotated-away refresh
   * token is presented again (reuse/compromise signal), never as part of normal rotation.
   * `userId` must be cast to `Types.ObjectId` explicitly: unlike `findOneAndUpdate`/`findOne`
   * filters elsewhere in this class (which Mongoose casts against the schema path
   * automatically), a plain string here silently matched zero documents against the real
   * ObjectId-typed `userId` field — caught by a real-MongoDB e2e test, never by a mocked one.
   */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.sessionModel
      .updateMany(
        { userId: new Types.ObjectId(userId), revokedAt: null },
        { revokedAt: new Date() },
      )
      .exec();
  }
}
