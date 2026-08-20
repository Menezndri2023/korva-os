import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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

  markConverted(
    organizationId: string,
    cartId: string,
  ): Promise<CartDocument | null> {
    return this.cartModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(cartId),
          organizationId: new Types.ObjectId(organizationId),
        },
        { status: 'converted' },
        { new: true },
      )
      .exec();
  }
}
