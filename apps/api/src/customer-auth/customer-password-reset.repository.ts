import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CustomerPasswordResetToken,
  CustomerPasswordResetTokenDocument,
} from './schemas/customer-password-reset-token.schema';

@Injectable()
export class CustomerPasswordResetRepository {
  constructor(
    @InjectModel(CustomerPasswordResetToken.name)
    private readonly model: Model<CustomerPasswordResetTokenDocument>,
  ) {}

  /** Same upsert-with-race-fallback pattern as PasswordResetRepository.issue — see that
   *  method's doc for why the try/catch-on-duplicate-key branch is needed. */
  async issue(
    customerAccountId: Types.ObjectId,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<void> {
    try {
      await this.model.findOneAndUpdate(
        { customerAccountId },
        { $set: { tokenHash, expiresAt, usedAt: null } },
        { upsert: true },
      );
    } catch (error) {
      if (!isDuplicateCustomerAccountIdError(error)) throw error;
      await this.model.updateOne(
        { customerAccountId },
        { $set: { tokenHash, expiresAt, usedAt: null } },
      );
    }
  }

  /** Same atomic find-and-consume pattern as PasswordResetRepository.consume. */
  consume(
    tokenHash: string,
  ): Promise<CustomerPasswordResetTokenDocument | null> {
    return this.model
      .findOneAndUpdate(
        { tokenHash, usedAt: null, expiresAt: { $gt: new Date() } },
        { $set: { usedAt: new Date() } },
        { new: true },
      )
      .exec();
  }
}

function isDuplicateCustomerAccountIdError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as Record<string, unknown>;
  return (
    code === 11000 &&
    typeof message === 'string' &&
    message.includes('customerAccountId')
  );
}
