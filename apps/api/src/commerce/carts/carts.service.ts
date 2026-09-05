import { Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { Pagination } from '@korva/types';
import type { AddCartItemInput, UpdateCartItemInput } from '@korva/validation';
import { CartsRepository } from './carts.repository';
import { CartDocument } from './schemas/cart.schema';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { OffersService } from '../../catalog/offers/offers.service';

@Injectable()
export class CartsService {
  constructor(
    private readonly cartsRepository: CartsRepository,
    private readonly contactsService: ContactsService,
    private readonly offersService: OffersService,
  ) {}

  async getOrCreateForContact(
    organizationId: string,
    contactId: string,
  ): Promise<CartDocument> {
    const existing = await this.cartsRepository.findOpenForContact(
      organizationId,
      contactId,
    );
    if (existing) return existing;

    const contactExists = await this.contactsService.existsById(
      organizationId,
      contactId,
    );
    if (!contactExists) {
      throw new NotFoundException({
        code: 'CONTACT_NOT_FOUND',
        message: 'Contact not found',
      });
    }

    return this.cartsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      contactId: new Types.ObjectId(contactId),
      status: 'open',
      items: [],
    });
  }

  async getById(organizationId: string, id: string): Promise<CartDocument> {
    const cart = await this.cartsRepository.findById(organizationId, id);
    if (!cart) {
      throw new NotFoundException({
        code: 'CART_NOT_FOUND',
        message: 'Cart not found',
      });
    }
    return cart;
  }

  async addItem(
    organizationId: string,
    cartId: string,
    input: AddCartItemInput,
  ): Promise<CartDocument> {
    await this.offersService.getById(organizationId, input.offerId);
    const updated = await this.cartsRepository.addOrIncrementItem(
      organizationId,
      cartId,
      input.offerId,
      input.quantity,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'CART_NOT_FOUND',
        message: 'Cart not found',
      });
    }
    return updated;
  }

  async updateItem(
    organizationId: string,
    cartId: string,
    itemId: string,
    input: UpdateCartItemInput,
  ): Promise<CartDocument> {
    const updated = await this.cartsRepository.updateItemQuantity(
      organizationId,
      cartId,
      itemId,
      input.quantity,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'CART_OR_ITEM_NOT_FOUND',
        message: 'Cart or item not found',
      });
    }
    return updated;
  }

  async removeItem(
    organizationId: string,
    cartId: string,
    itemId: string,
  ): Promise<CartDocument> {
    const updated = await this.cartsRepository.removeItem(
      organizationId,
      cartId,
      itemId,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'CART_NOT_FOUND',
        message: 'Cart not found',
      });
    }
    return updated;
  }

  /**
   * Called from PublicService#trackCheckoutStarted once a storefront visitor's email becomes
   * known during checkout — the only real hook point available, since the storefront's own cart
   * is otherwise a client-side-only localStorage concept the backend never sees (see
   * apps/storefront/src/lib/use-cart.ts's own doc comment). Every offerId is validated against
   * the real Offer, same as addItem, but as a batch since this replaces the whole snapshot.
   */
  async syncItemsForContact(
    organizationId: string,
    contactId: string,
    items: { offerId: string; quantity: number }[],
  ): Promise<CartDocument> {
    await Promise.all(
      items.map((item) =>
        this.offersService.getById(organizationId, item.offerId),
      ),
    );
    const cart = await this.getOrCreateForContact(organizationId, contactId);
    const updated = await this.cartsRepository.replaceItems(
      organizationId,
      cart.id as string,
      items.map((item) => ({
        offerId: new Types.ObjectId(item.offerId),
        quantity: item.quantity,
      })),
    );
    // cart was just resolved/created above, so this can only be null on a genuinely concurrent
    // deletion — vanishingly unlikely for a Cart, which nothing in this codebase ever deletes.
    if (!updated) {
      throw new NotFoundException({
        code: 'CART_NOT_FOUND',
        message: 'Cart not found',
      });
    }
    return updated;
  }

  /** Best-effort — see CartsRepository.markConvertedForContact's own doc comment for scope. */
  async markConvertedForContact(
    organizationId: string,
    contactId: string,
  ): Promise<void> {
    await this.cartsRepository.markConvertedForContact(
      organizationId,
      contactId,
    );
  }

  async listAbandoned(
    organizationId: string,
    page: number,
    limit: number,
  ): Promise<{ data: CartDocument[]; pagination: Pagination }> {
    const { data, total } = await this.cartsRepository.findAbandoned(
      organizationId,
      page,
      limit,
    );
    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }
}
