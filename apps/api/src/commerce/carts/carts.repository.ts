import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Cart, CartDocument } from './schemas/cart.schema';

@Injectable()
export class CartsRepository {
  constructor(
    @InjectModel(Cart.name) private readonly cartModel: Model<CartDocument>,
  ) {}

  create(data: Partial<Cart>): Promise<CartDocument> {
    return this.cartModel.create(data);
  }

  findOpenForContact(
    organizationId: string,
    contactId: string,
  ): Promise<CartDocument | null> {
    return this.cartModel
      .findOne({
        organizationId: new Types.ObjectId(organizationId),
        contactId: new Types.ObjectId(contactId),
        status: 'open',
      })
      .exec();
  }

  /** Newest-first — backs the staff "Paniers abandonnés" list. Registered as a dedicated
   *  literal-segment route (`carts/abandoned`) before `carts/:id` in the controller, same
   *  ordering precedent as `offers/search`/`offers/categories` before `offers/:offerId`. */
  findAbandoned(
    organizationId: string,
    page: number,
    limit: number,
  ): Promise<{ data: CartDocument[]; total: number }> {
    const filter = {
      organizationId: new Types.ObjectId(organizationId),
      status: 'abandoned' as const,
    };
    return Promise.all([
      this.cartModel
        .find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.cartModel.countDocuments(filter).exec(),
    ]).then(([data, total]) => ({ data, total }));
  }

  findById(organizationId: string, id: string): Promise<CartDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.cartModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async addOrIncrementItem(
    organizationId: string,
    cartId: string,
    offerId: string,
    quantity: number,
  ): Promise<CartDocument | null> {
    const incremented = await this.cartModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(cartId),
          organizationId: new Types.ObjectId(organizationId),
          'items.offerId': new Types.ObjectId(offerId),
        },
        { $inc: { 'items.$.quantity': quantity } },
        { new: true },
      )
      .exec();
    if (incremented) return incremented;

    return this.cartModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(cartId),
          organizationId: new Types.ObjectId(organizationId),
        },
        {
          $push: { items: { offerId: new Types.ObjectId(offerId), quantity } },
        },
        { new: true },
      )
      .exec();
  }

  updateItemQuantity(
    organizationId: string,
    cartId: string,
    itemId: string,
    quantity: number,
  ): Promise<CartDocument | null> {
    return this.cartModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(cartId),
          organizationId: new Types.ObjectId(organizationId),
          'items._id': new Types.ObjectId(itemId),
        },
        { $set: { 'items.$.quantity': quantity } },
        { new: true },
      )
      .exec();
  }

  removeItem(
    organizationId: string,
    cartId: string,
    itemId: string,
  ): Promise<CartDocument | null> {
    return this.cartModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(cartId),
          organizationId: new Types.ObjectId(organizationId),
        },
        { $pull: { items: { _id: new Types.ObjectId(itemId) } } },
        { new: true },
      )
      .exec();
  }

  /** Full-replace, not delta — used only by the abandoned-cart capture flow, which always
   *  receives a complete "current cart" snapshot from the storefront, unlike the incremental
   *  addOrIncrementItem/updateItemQuantity/removeItem trio used by the staff-facing dashboard
   *  cart UI. */
  replaceItems(
    organizationId: string,
    cartId: string,
    items: { offerId: Types.ObjectId; quantity: number }[],
  ): Promise<CartDocument | null> {
    return this.cartModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(cartId),
          organizationId: new Types.ObjectId(organizationId),
        },
        { $set: { items } },
        { new: true },
      )
      .exec();
  }

  /** Every open OR already-abandoned cart for this contact is closed out as 'converted' once a
   *  real order exists for them — a customer can complete checkout even after receiving (or
   *  past the threshold for) a recovery reminder, and that reminder must never fire again for an
   *  episode that's now moot. Scoped by contactId, not a specific cart id, since the storefront
   *  capture flow never surfaces a cart id back to the checkout form that later creates the
   *  order — see PublicService#trackCheckoutStarted / #createOrder. */
  markConvertedForContact(
    organizationId: string,
    contactId: string,
  ): Promise<CartDocument | null> {
    return this.cartModel
      .findOneAndUpdate(
        {
          organizationId: new Types.ObjectId(organizationId),
          contactId: new Types.ObjectId(contactId),
          status: { $in: ['open', 'abandoned'] },
        },
        { status: 'converted' },
        { new: true },
      )
      .exec();
  }

  /** Global sweep across every organization — same cross-tenant scan shape as every other
   *  scheduler in this codebase (QuoteExpirySchedulerService, BookingReminderSchedulerService,
   *  ...). `'items.0': { $exists: true }` is the idiomatic Mongo way to filter "array is
   *  non-empty" (a cart can legitimately sit open with zero items — nothing to recover there). */
  findAbandonedCandidates(olderThan: Date): Promise<CartDocument[]> {
    return this.cartModel
      .find({
        status: 'open',
        'items.0': { $exists: true },
        updatedAt: { $lt: olderThan },
      })
      .exec();
  }

  /** Guarded the same way markReminderSentIfEligible (BookingsRepository) is: the `status:'open'`
   *  filter runs inside the same atomic update as the write, so a cart converted by a real
   *  checkout in the moment between the sweep's read and this write can never be knocked back to
   *  'abandoned' after the fact. */
  markAbandonedIfEligible(
    organizationId: string,
    cartId: string,
  ): Promise<CartDocument | null> {
    return this.cartModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(cartId),
          organizationId: new Types.ObjectId(organizationId),
          status: 'open',
        },
        { status: 'abandoned', notifiedAt: new Date() },
        { new: true },
      )
      .exec();
  }

  /**
   * Atomic guard against concurrent createFromCart() calls for the same cart: the accept/reject
   * decision ("is this cart still open") is made by MongoDB itself, in the SAME
   * findOneAndUpdate as the write, via `status: 'open'` in the filter — not from the `cart`
   * snapshot OrdersService.createFromCart read moments earlier. Two concurrent checkouts of the
   * same cart can therefore never both match: only one findAndModify wins the document at a
   * time. Resolves to null if the filter didn't match — either the cart doesn't exist or (the
   * case this method exists for) it was already converted; the caller treats null as
   * CART_NOT_OPEN. Same pattern as OrdersRepository.attachInvoiceIfUnset.
   *
   * `session`, when given, ties this update to the caller's MongoDB transaction so it
   * commits/aborts together with the Order insert (see OrdersService.createFromCart) — a crash
   * or thrown error between the two can never leave a 'converted' cart with no Order, or an
   * Order created from a cart that stayed 'open' for a second checkout.
   */
  markConvertedIfOpen(
    organizationId: string,
    cartId: string,
    session?: ClientSession,
  ): Promise<CartDocument | null> {
    return this.cartModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(cartId),
          organizationId: new Types.ObjectId(organizationId),
          status: 'open',
        },
        { status: 'converted' },
        { new: true, session },
      )
      .exec();
  }
}
