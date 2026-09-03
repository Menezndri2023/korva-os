import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { Offer, OfferDocument } from './schemas/offer.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindOffersOptions {
  page: number;
  limit: number;
  search?: string;
  type?: string;
  status?: string;
  category?: string;
  sort?: 'newest' | 'price_asc' | 'price_desc';
}

const SORT_SPECS: Record<
  NonNullable<FindOffersOptions['sort']>,
  Record<string, 1 | -1>
> = {
  newest: { createdAt: -1 },
  price_asc: { 'pricing.amount': 1 },
  price_desc: { 'pricing.amount': -1 },
};

@Injectable()
export class OffersRepository {
  constructor(
    @InjectModel(Offer.name) private readonly offerModel: Model<OfferDocument>,
  ) {}

  create(data: Partial<Offer>): Promise<OfferDocument> {
    return this.offerModel.create(data);
  }

  findById(organizationId: string, id: string): Promise<OfferDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.offerModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  /**
   * Batched `$in` lookup for a set of offer ids in one round trip — used by
   * OrdersService.createFromCart instead of one findById() per cart line item (the N+1 the audit
   * flagged). Invalid ids are silently dropped rather than throwing, matching findById()'s own
   * "not a valid ObjectId means not found" behavior; the caller (OffersService.getManyByIds)
   * is responsible for turning a missing id into OFFER_NOT_FOUND.
   */
  findByIds(
    organizationId: string,
    ids: string[],
    session?: ClientSession,
  ): Promise<OfferDocument[]> {
    const validIds = ids
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));
    if (validIds.length === 0) return Promise.resolve([]);

    return this.offerModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        _id: { $in: validIds },
      })
      .session(session ?? null)
      .exec();
  }

  /**
   * Atomic reserve — single-document `findOneAndUpdate` with a `$gte` guard, so this is already
   * race-safe on its own without needing the booking module's resource-lock-version trick (that
   * exists because booking's check and insert are two separate documents; here the check and
   * write are the same document). Returns null if trackStock is false, the offer doesn't exist,
   * or there isn't enough stock — the caller can't tell those apart from this alone, which is
   * fine: InventoryService.reserveStock skips non-tracked offers before ever calling this, so a
   * null here always means "insufficient stock" in practice.
   *
   * Variant-aware: when `variantId` is given, decrements that specific variant's stockOnHand
   * (via arrayFilters) instead of the offer's own — an offer with variants keeps its stock
   * entirely on each variant, independent of the others (see OfferVariant.stockOnHand).
   */
  async decrementStockIfAvailable(
    organizationId: string,
    offerId: string,
    quantity: number,
    variantId: string | undefined,
    session?: ClientSession,
  ): Promise<{ offer: OfferDocument; stockAfter: number } | null> {
    if (!Types.ObjectId.isValid(offerId)) return null;
    if (variantId && !Types.ObjectId.isValid(variantId)) return null;

    const offer = variantId
      ? await this.offerModel
          .findOneAndUpdate(
            {
              _id: new Types.ObjectId(offerId),
              organizationId: new Types.ObjectId(organizationId),
              trackStock: true,
              variants: {
                $elemMatch: {
                  _id: new Types.ObjectId(variantId),
                  stockOnHand: { $gte: quantity },
                },
              },
            },
            { $inc: { 'variants.$[v].stockOnHand': -quantity } },
            {
              new: true,
              session,
              arrayFilters: [{ 'v._id': new Types.ObjectId(variantId) }],
            },
          )
          .exec()
      : await this.offerModel
          .findOneAndUpdate(
            {
              _id: new Types.ObjectId(offerId),
              organizationId: new Types.ObjectId(organizationId),
              trackStock: true,
              stockOnHand: { $gte: quantity },
            },
            { $inc: { stockOnHand: -quantity } },
            { new: true, session },
          )
          .exec();

    if (!offer) return null;
    return { offer, stockAfter: extractStock(offer, variantId) };
  }

  /** Restock path (order cancelled/item removed) — only meaningful for tracked offers; a no-op
   *  (matches nothing) for an untracked offer, same as decrementStockIfAvailable. Never guarded
   *  by a $gte check (there is no upper bound to restore stock past), so this always succeeds
   *  for a tracked offer/variant that exists. */
  async incrementStock(
    organizationId: string,
    offerId: string,
    quantity: number,
    variantId: string | undefined,
    session?: ClientSession,
  ): Promise<{ offer: OfferDocument; stockAfter: number } | null> {
    if (!Types.ObjectId.isValid(offerId)) return null;
    if (variantId && !Types.ObjectId.isValid(variantId)) return null;

    const offer = variantId
      ? await this.offerModel
          .findOneAndUpdate(
            {
              _id: new Types.ObjectId(offerId),
              organizationId: new Types.ObjectId(organizationId),
              trackStock: true,
              'variants._id': new Types.ObjectId(variantId),
            },
            { $inc: { 'variants.$[v].stockOnHand': quantity } },
            {
              new: true,
              session,
              arrayFilters: [{ 'v._id': new Types.ObjectId(variantId) }],
            },
          )
          .exec()
      : await this.offerModel
          .findOneAndUpdate(
            {
              _id: new Types.ObjectId(offerId),
              organizationId: new Types.ObjectId(organizationId),
              trackStock: true,
            },
            { $inc: { stockOnHand: quantity } },
            { new: true, session },
          )
          .exec();

    if (!offer) return null;
    return { offer, stockAfter: extractStock(offer, variantId) };
  }

  async findAll(
    organizationId: string,
    options: FindOffersOptions,
  ): Promise<Paginated<OfferDocument>> {
    const filter: FilterQuery<Offer> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.type) filter.type = options.type;
    if (options.status) filter.status = options.status;
    if (options.category) filter.categories = options.category;
    if (options.search) filter.$text = { $search: options.search };

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.offerModel
        .find(filter)
        .sort(SORT_SPECS[options.sort ?? 'newest'])
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.offerModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  /** Distinct category values across an organization's ACTIVE offers only — backs the public
   *  catalogue page's filter list, which must never surface a category that only exists on a
   *  draft/archived offer a visitor could never actually see in the results. */
  distinctActiveCategories(organizationId: string): Promise<string[]> {
    return this.offerModel.distinct('categories', {
      organizationId: new Types.ObjectId(organizationId),
      status: 'active',
    });
  }

  /** Absolute-set counterpart to update() scoped to one variant's stockOnHand — used by
   *  OffersService.adjustStock's variant path, since `data: Partial<Offer>` has no way to target
   *  a specific array element. */
  updateVariantStock(
    organizationId: string,
    id: string,
    variantId: string,
    stockOnHand: number,
  ): Promise<OfferDocument | null> {
    if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(variantId)) {
      return Promise.resolve(null);
    }
    return this.offerModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
          'variants._id': new Types.ObjectId(variantId),
        },
        { $set: { 'variants.$[v].stockOnHand': stockOnHand } },
        {
          new: true,
          arrayFilters: [{ 'v._id': new Types.ObjectId(variantId) }],
        },
      )
      .exec();
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Offer>,
  ): Promise<OfferDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.offerModel
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
    const res = await this.offerModel
      .deleteOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
    return res.deletedCount > 0;
  }
}

/** Reads whichever stockOnHand a stock operation actually affected — the variant's if a
 *  variantId was given, else the offer's own. Variant subdocuments carry `_id` at runtime
 *  (OfferVariant's schema declares `{_id: true}`) even though the plain OfferVariant class
 *  doesn't type it, so this reaches in via an unknown-cast rather than widening that type. */
function extractStock(offer: OfferDocument, variantId?: string): number {
  if (!variantId) return offer.stockOnHand ?? 0;
  const variant = offer.variants.find(
    (v) =>
      (v as unknown as { _id: Types.ObjectId })._id.toString() === variantId,
  );
  return variant?.stockOnHand ?? 0;
}
