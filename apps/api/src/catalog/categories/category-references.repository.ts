import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Offer, OfferDocument } from '../offers/schemas/offer.schema';

/**
 * Offer.categories deliberately stays the free-text string[] it already was (see
 * CategoriesService for why Offer.categories was NOT switched to Category id references) — so
 * "does any Offer still reference this Category" is necessarily a name match, not an id match.
 * Renaming a Category therefore does not relabel offers that already reference its old name
 * (documented limitation); this check only guards deletion against the Category's *current*
 * name, matching what a caller sees right now.
 *
 * Modeled on OfferReferencesRepository (catalog/offers/offer-references.repository.ts): direct
 * @InjectModel of Offer here rather than depending on OffersService, since both live inside the
 * same CatalogModule already.
 */
@Injectable()
export class CategoryReferencesRepository {
  constructor(
    @InjectModel(Offer.name) private readonly offerModel: Model<OfferDocument>,
  ) {}

  async isReferencedByName(
    organizationId: string,
    name: string,
  ): Promise<boolean> {
    const result = await this.offerModel.exists({
      organizationId: new Types.ObjectId(organizationId),
      categories: name,
    });
    return Boolean(result);
  }
}
