import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CustomerSession,
  CustomerSessionDocument,
} from './schemas/customer-session.schema';

@Injectable()
export class CustomerSessionRepository {
  constructor(
    @InjectModel(CustomerSession.name)
    private readonly model: Model<CustomerSessionDocument>,
  ) {}

  create(data: Partial<CustomerSession>): Promise<CustomerSessionDocument> {
    return this.model.create(data);
  }

  /** Same atomic accept/reject-by-filter pattern as SessionsRepository.revokeActiveByTokenHash. */
  revokeActiveByTokenHash(
    refreshTokenHash: string,
  ): Promise<CustomerSessionDocument | null> {
    return this.model
      .findOneAndUpdate(
        { refreshTokenHash, revokedAt: null, expiresAt: { $gt: new Date() } },
        { revokedAt: new Date() },
        { new: true },
      )
      .exec();
  }

  findByTokenHash(
    refreshTokenHash: string,
  ): Promise<CustomerSessionDocument | null> {
    return this.model.findOne({ refreshTokenHash }).exec();
  }

  async revokeByTokenHash(refreshTokenHash: string): Promise<void> {
    await this.model
      .updateOne({ refreshTokenHash }, { revokedAt: new Date() })
      .exec();
  }

  async revokeAllForAccount(customerAccountId: string): Promise<void> {
    await this.model
      .updateMany(
        {
          customerAccountId: new Types.ObjectId(customerAccountId),
          revokedAt: null,
        },
        { revokedAt: new Date() },
      )
      .exec();
  }
}
