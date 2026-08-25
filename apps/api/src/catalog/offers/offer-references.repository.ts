import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Order,
  OrderDocument,
} from '../../commerce/orders/schemas/order.schema';
import { Cart, CartDocument } from '../../commerce/carts/schemas/cart.schema';
import {
  Booking,
  BookingDocument,
} from '../../booking/bookings/schemas/booking.schema';
import {
  Invoice,
  InvoiceDocument,
} from '../../finance/invoices/schemas/invoice.schema';
import {
  Quote,
  QuoteDocument,
} from '../../finance/quotes/schemas/quote.schema';

/**
 * Every business entity that can hold a persistent offerId, queried directly via @InjectModel
 * rather than through each entity's own repository/service — those live in modules that
 * already import CatalogModule (Commerce, Booking and Finance all depend on Catalog for
 * OffersService.getById), so CatalogModule importing them back would be a circular module
 * dependency. Same fix already used for ContactReferencesRepository (crm/contacts) — direct
 * model injection, zero forwardRef() usage anywhere in the codebase.
 *
 * Order/Quote/Invoice hold offerId inside their shared LineItem sub-documents (items[].offerId,
 * optional there since a manually-typed line has no offer); Booking and Cart hold it as a
 * required field (Booking.offerId directly, Cart.items[].offerId per item).
 */
@Injectable()
export class OfferReferencesRepository {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Quote.name) private readonly quoteModel: Model<QuoteDocument>,
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(Cart.name) private readonly cartModel: Model<CartDocument>,
  ) {}

  /**
   * True if any business record still references this offer within this organization —
   * regardless of status (e.g. a cancelled order or an abandoned cart). None of the five
   * schemas support a soft-delete/archival state that would make an existing reference safe
   * to orphan, matching the same policy already applied to contact deletion (LOT F5).
   */
  async hasAnyReference(
    organizationId: string,
    offerId: string,
  ): Promise<boolean> {
    if (!Types.ObjectId.isValid(offerId)) return false;

    const orgFilter = { organizationId: new Types.ObjectId(organizationId) };
    const offerObjectId = new Types.ObjectId(offerId);

    const results = await Promise.all([
      this.orderModel.exists({ ...orgFilter, 'items.offerId': offerObjectId }),
      this.quoteModel.exists({ ...orgFilter, 'items.offerId': offerObjectId }),
      this.invoiceModel.exists({
        ...orgFilter,
        'items.offerId': offerObjectId,
      }),
      this.bookingModel.exists({ ...orgFilter, offerId: offerObjectId }),
      this.cartModel.exists({ ...orgFilter, 'items.offerId': offerObjectId }),
    ]);

    return results.some((result) => Boolean(result));
  }
}
