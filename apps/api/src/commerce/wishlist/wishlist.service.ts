import { Injectable } from '@nestjs/common';
import { WishlistRepository } from './wishlist.repository';
import { OffersService } from '../../catalog/offers/offers.service';

export interface WishlistEntry {
  id: string;
  offerId: string;
  offerName: string;
  offerImage?: string;
  pricing: { amount: number; currency: string };
  createdAt: Date;
}

@Injectable()
export class WishlistService {
  constructor(
    private readonly wishlistRepository: WishlistRepository,
    private readonly offersService: OffersService,
  ) {}

  async add(
    organizationId: string,
    contactId: string,
    offerId: string,
  ): Promise<void> {
    // Confirms the offer actually exists in this org before saving a reference to it — throws
    // the same OFFER_NOT_FOUND a caller would get from any other offer-referencing endpoint.
    await this.offersService.getById(organizationId, offerId);
    await this.wishlistRepository.add(organizationId, contactId, offerId);
  }

  async remove(
    organizationId: string,
    contactId: string,
    offerId: string,
  ): Promise<void> {
    await this.wishlistRepository.remove(organizationId, contactId, offerId);
  }

  /** Silently omits an item whose offer has since been deleted — see
   *  OffersService.findManyByIds's own doc comment for why this is the one place in the
   *  codebase that's tolerant of a missing offer reference. */
  async list(
    organizationId: string,
    contactId: string,
  ): Promise<WishlistEntry[]> {
    const items = await this.wishlistRepository.findAllForContact(
      organizationId,
      contactId,
    );
    if (items.length === 0) return [];

    const offers = await this.offersService.findManyByIds(
      organizationId,
      items.map((item) => item.offerId.toString()),
    );
    const offerById = new Map(
      offers.map((offer) => [offer.id as string, offer]),
    );

    return items
      .map((item): WishlistEntry | null => {
        const offer = offerById.get(item.offerId.toString());
        if (!offer) return null;
        const entry: WishlistEntry = {
          id: item.id as string,
          offerId: item.offerId.toString(),
          offerName: offer.name,
          pricing: offer.pricing,
          createdAt: (item as unknown as { createdAt: Date }).createdAt,
        };
        if (offer.images?.[0]) entry.offerImage = offer.images[0];
        return entry;
      })
      .filter((entry): entry is WishlistEntry => entry !== null);
  }
}
