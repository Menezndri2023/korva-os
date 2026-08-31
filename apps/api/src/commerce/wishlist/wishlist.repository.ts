import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WishlistItem,
  WishlistItemDocument,
} from './schemas/wishlist-item.schema';

@Injectable()
export class WishlistRepository {
  constructor(
    @InjectModel(WishlistItem.name)
    private readonly model: Model<WishlistItemDocument>,
  ) {}

  /** Upsert, not create — adding an offer already on the wishlist is a no-op, not a conflict,
   *  matching how a "save" toggle should feel from the customer's side. The unique index is
   *  still what makes this atomic under concurrent double-clicks, not just this upsert option. */
  async add(
    organizationId: string,
    contactId: string,
    offerId: string,
  ): Promise<WishlistItemDocument> {
    return this.model
      .findOneAndUpdate(
        {
          organizationId: new Types.ObjectId(organizationId),
          contactId: new Types.ObjectId(contactId),
          offerId: new Types.ObjectId(offerId),
        },
        {},
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
  }

  async remove(
    organizationId: string,
    contactId: string,
    offerId: string,
  ): Promise<void> {
    await this.model
      .deleteOne({
        organizationId: new Types.ObjectId(organizationId),
        contactId: new Types.ObjectId(contactId),
        offerId: new Types.ObjectId(offerId),
      })
      .exec();
  }

  findAllForContact(
    organizationId: string,
    contactId: string,
  ): Promise<WishlistItemDocument[]> {
    return this.model
      .find({
        organizationId: new Types.ObjectId(organizationId),
        contactId: new Types.ObjectId(contactId),
      })
      .sort({ createdAt: -1 })
      .exec();
  }
}
