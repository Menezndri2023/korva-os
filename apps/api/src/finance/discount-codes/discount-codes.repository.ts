import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import {
  DiscountCode,
  DiscountCodeDocument,
} from './schemas/discount-code.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindDiscountCodesOptions {
  page: number;
  limit: number;
  active?: boolean;
}

@Injectable()
export class DiscountCodesRepository {
  constructor(
    @InjectModel(DiscountCode.name)
    private readonly discountCodeModel: Model<DiscountCodeDocument>,
  ) {}

  create(data: Partial<DiscountCode>): Promise<DiscountCodeDocument> {
    return this.discountCodeModel.create(data);
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<DiscountCodeDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.discountCodeModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  findByCode(
    organizationId: string,
    code: string,
  ): Promise<DiscountCodeDocument | null> {
    return this.discountCodeModel
      .findOne({ organizationId: new Types.ObjectId(organizationId), code })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindDiscountCodesOptions,
  ): Promise<Paginated<DiscountCodeDocument>> {
    const filter: FilterQuery<DiscountCode> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.active !== undefined) filter.active = options.active;

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.discountCodeModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.discountCodeModel.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<DiscountCode>,
  ): Promise<DiscountCodeDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.discountCodeModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        data,
        { new: true },
      )
      .exec();
  }

  async delete(organizationId: string, id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const res = await this.discountCodeModel
      .deleteOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
    return res.deletedCount > 0;
  }

  /**
   * Single atomic `findOneAndUpdate` — the eligibility check (active, within date window, under
   * the redemption cap) and the `redemptionsCount` increment happen in the same MongoDB
   * operation, so two concurrent checkouts racing the last remaining redemption can never both
   * win. No lock-version field needed (unlike the booking capacity check): this is a single
   * document, not a check-across-many-documents-then-insert-a-new-one race.
   */
  reserveIfEligible(
    organizationId: string,
    code: string,
    now: Date,
    session?: ClientSession,
  ): Promise<DiscountCodeDocument | null> {
    return this.discountCodeModel
      .findOneAndUpdate(
        {
          organizationId: new Types.ObjectId(organizationId),
          code,
          active: true,
          $and: [
            {
              $or: [
                { startsAt: { $exists: false } },
                { startsAt: { $lte: now } },
              ],
            },
            {
              $or: [
                { expiresAt: { $exists: false } },
                { expiresAt: { $gte: now } },
              ],
            },
          ],
          // $expr's aggregation-style $eq treats a genuinely missing field as not-equal to null
          // (unlike plain query-language equality, where missing and null ARE treated as equal)
          // — confirmed empirically, not assumed. $ifNull normalizes the missing case first.
          $expr: {
            $or: [
              { $eq: [{ $ifNull: ['$maxRedemptions', null] }, null] },
              { $lt: ['$redemptionsCount', '$maxRedemptions'] },
            ],
          },
        },
        { $inc: { redemptionsCount: 1 } },
        { new: true, session },
      )
      .exec();
  }

  /** Rolls back a reservation (order cancelled, or a later step in the same checkout
   *  transaction failed) — floored at 0 defensively, though it should never go negative in
   *  practice since release() is only ever called after a matching reserveIfEligible(). */
  release(
    organizationId: string,
    id: string,
    session?: ClientSession,
  ): Promise<DiscountCodeDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.discountCodeModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          redemptionsCount: { $gt: 0 },
        },
        { $inc: { redemptionsCount: -1 } },
        { new: true, session },
      )
      .exec();
  }
}
