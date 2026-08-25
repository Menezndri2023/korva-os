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
