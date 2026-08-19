import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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

  findActiveByTokenHash(
    refreshTokenHash: string,
  ): Promise<SessionDocument | null> {
    return this.sessionModel
      .findOne({
        refreshTokenHash,
        revokedAt: null,
        expiresAt: { $gt: new Date() },
      })
      .select('+refreshTokenHash')
      .exec();
  }

  async revoke(id: string): Promise<void> {
    await this.sessionModel
      .findByIdAndUpdate(id, { revokedAt: new Date() })
      .exec();
  }

  async revokeByTokenHash(refreshTokenHash: string): Promise<void> {
    await this.sessionModel
      .updateOne({ refreshTokenHash }, { revokedAt: new Date() })
      .exec();
  }
}
