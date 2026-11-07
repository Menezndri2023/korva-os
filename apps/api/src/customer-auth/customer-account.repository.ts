import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CustomerAccount,
  CustomerAccountDocument,
} from './schemas/customer-account.schema';

@Injectable()
export class CustomerAccountRepository {
  constructor(
    @InjectModel(CustomerAccount.name)
    private readonly model: Model<CustomerAccountDocument>,
  ) {}

  create(data: Partial<CustomerAccount>): Promise<CustomerAccountDocument> {
    return this.model.create(data);
  }

  findByOrgAndEmail(
    organizationId: string,
    email: string,
    withPasswordHash = false,
  ): Promise<CustomerAccountDocument | null> {
    const query = this.model.findOne({
      organizationId: new Types.ObjectId(organizationId),
      email: email.toLowerCase().trim(),
    });
    if (withPasswordHash) query.select('+passwordHash');
    return query.exec();
  }

  findByOrgAndContactId(
    organizationId: string,
    contactId: string,
  ): Promise<CustomerAccountDocument | null> {
    return this.model
      .findOne({
        organizationId: new Types.ObjectId(organizationId),
        contactId: new Types.ObjectId(contactId),
      })
      .exec();
  }

  findById(id: string): Promise<CustomerAccountDocument | null> {
    return this.model.findById(id).exec();
  }

  /** Same atomic-increment-then-compare pattern as UsersRepository.incrementFailedAttempts. */
  async incrementFailedAttempts(id: string): Promise<number> {
    const account = await this.model
      .findByIdAndUpdate(
        id,
        { $inc: { failedLoginAttempts: 1 } },
        { new: true },
      )
      .exec();
    return account?.failedLoginAttempts ?? 0;
  }

  async lockAccount(id: string, lockedUntil: Date): Promise<void> {
    await this.model
      .updateOne({ _id: id }, { lockedUntil, failedLoginAttempts: 0 })
      .exec();
  }

  async resetFailedAttempts(id: string): Promise<void> {
    await this.model
      .updateOne({ _id: id }, { failedLoginAttempts: 0, lockedUntil: null })
      .exec();
  }

  async recordLogin(id: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { lastLoginAt: new Date() }).exec();
  }

  /** The business's own list: newest first, optionally by e-mail. */
  list(
    organizationId: string,
    search: string | undefined,
    limit: number,
  ): Promise<CustomerAccountDocument[]> {
    const filter: Record<string, unknown> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (search) {
      filter.email = {
        $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        $options: 'i',
      };
    }
    return this.model.find(filter).sort({ createdAt: -1 }).limit(limit).exec();
  }

  async setDisabled(
    organizationId: string,
    id: string,
    disabled: boolean,
  ): Promise<CustomerAccountDocument | null> {
    return this.model
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        { disabledAt: disabled ? new Date() : null },
        { new: true },
      )
      .exec();
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { passwordHash }).exec();
  }

  async getBasket(
    id: string,
  ): Promise<{ cart: unknown[]; saved: unknown[] } | null> {
    const account = await this.model.findById(id, { basket: 1 }).lean().exec();
    return account?.basket
      ? { cart: account.basket.cart, saved: account.basket.saved }
      : null;
  }

  async setBasket(
    id: string,
    basket: { cart: unknown[]; saved: unknown[] },
  ): Promise<void> {
    await this.model
      .updateOne(
        { _id: id },
        { $set: { basket: { ...basket, updatedAt: new Date() } } },
      )
      .exec();
  }
}
