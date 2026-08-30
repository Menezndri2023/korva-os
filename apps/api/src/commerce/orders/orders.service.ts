import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import type { CreateOrderInput, LineItemInput } from '@korva/validation';
import type { Pagination } from '@korva/types';
import { OrdersRepository, FindOrdersOptions } from './orders.repository';
import { OrderDocument } from './schemas/order.schema';
import { CartsRepository } from '../carts/carts.repository';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { OffersService } from '../../catalog/offers/offers.service';
import { InventoryService } from '../../catalog/offers/inventory.service';
import { BookingsService } from '../../booking/bookings/bookings.service';
import { InvoicesService } from '../../finance/invoices/invoices.service';
import { InvoiceDocument } from '../../finance/invoices/schemas/invoice.schema';
import { FulfillmentsService } from '../fulfillments/fulfillments.service';
import { CountersService } from '../../core/counters/counters.service';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';
import { computeTotals, toLineItemDocs } from '../../shared/line-item.schema';
import { DiscountCodesService } from '../../finance/discount-codes/discount-codes.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly cartsRepository: CartsRepository,
    private readonly contactsService: ContactsService,
    private readonly offersService: OffersService,
    private readonly inventoryService: InventoryService,
    private readonly bookingsService: BookingsService,
    private readonly invoicesService: InvoicesService,
    private readonly fulfillmentsService: FulfillmentsService,
    private readonly countersService: CountersService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
    private readonly discountCodesService: DiscountCodesService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(
    organizationId: string,
    userId: string,
    input: CreateOrderInput,
  ): Promise<OrderDocument> {
    const contactExists = await this.contactsService.existsById(
      organizationId,
      input.contactId,
    );
    if (!contactExists) {
      throw new NotFoundException({
        code: 'CONTACT_NOT_FOUND',
        message: 'Contact not found',
      });
    }

    return this.createOrderRecord(organizationId, userId, {
      contactId: input.contactId,
      items: input.items,
      currency: input.currency,
      notes: input.notes,
      source: 'manual',
      discountCode: input.discountCode,
    });
  }

  async createFromCart(
    organizationId: string,
    userId: string,
    cartId: string,
  ): Promise<OrderDocument> {
    const cart = await this.cartsRepository.findById(organizationId, cartId);
    if (!cart) {
      throw new NotFoundException({
        code: 'CART_NOT_FOUND',
        message: 'Cart not found',
      });
    }
    if (cart.status !== 'open') {
      throw new BadRequestException({
        code: 'CART_NOT_OPEN',
        message: 'This cart is not open',
      });
    }
    if (cart.items.length === 0) {
      throw new BadRequestException({
        code: 'CART_EMPTY',
        message: 'Cannot checkout an empty cart',
      });
    }

    // One batched `$in` lookup instead of one getById() round trip per line item.
    const offersById = await this.offersService.getManyByIds(
      organizationId,
      cart.items.map((item) => item.offerId.toString()),
    );
    const currency =
      offersById.get(cart.items[0]!.offerId.toString())?.pricing.currency ??
      'EUR';
    const items = cart.items.map((item) => {
      const offer = offersById.get(item.offerId.toString())!;
      return {
        offerId: item.offerId.toString(),
        description: offer.name,
        quantity: item.quantity,
        unitPrice: offer.pricing.amount,
        taxRate: offer.pricing.taxRate,
      };
    });

    const order = await this.createOrderFromCartAtomically(
      organizationId,
      cartId,
      {
        contactId: cart.contactId.toString(),
        items,
        currency,
      },
    );

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'order',
      entityId: order.id as string,
      metadata: { source: 'cart' },
    });

    await this.eventBus.publish(organizationId, 'order.created', {
      orderId: order.id as string,
      contactId: cart.contactId.toString(),
      total: order.total,
      source: 'cart',
    });

    return order;
  }

  /**
   * Order insert + Cart status update ('open' -> 'converted'), in a single MongoDB transaction:
   * either both writes commit, or neither does — closing the crash-between-writes gap identified
   * by the audit (an Order created from the cart while the Cart stayed 'open', so it could be
   * checked out a second time, or a Cart marked 'converted' with no Order actually persisted).
   * Mirrors generateInvoiceAtomically below exactly: the Cart update is conditioned on
   * `status: 'open'` (see CartsRepository.markConvertedIfOpen), evaluated by MongoDB at write
   * time — not from the `cart` snapshot read by the caller moments earlier — so two concurrent
   * checkouts of the same cart can never both win; the loser gets CART_NOT_OPEN, and the whole
   * transaction (including its Order insert) is rolled back rather than left half-applied.
   */
  private async createOrderFromCartAtomically(
    organizationId: string,
    cartId: string,
    input: {
      contactId: string;
      items: LineItemInput[];
      currency: string;
    },
  ): Promise<OrderDocument> {
    const totals = computeTotals(input.items);

    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        const convertedCart = await this.cartsRepository.markConvertedIfOpen(
          organizationId,
          cartId,
          session,
        );
        if (!convertedCart) {
          throw new BadRequestException({
            code: 'CART_NOT_OPEN',
            message: 'This cart is not open',
          });
        }

        await this.inventoryService.reserveStock(
          organizationId,
          input.items,
          session,
        );

        const number = await this.countersService.nextFormatted(
          organizationId,
          'order',
          'CMD',
        );

        return this.ordersRepository.create(
          {
            organizationId: new Types.ObjectId(organizationId),
            contactId: new Types.ObjectId(input.contactId),
            number,
            source: 'cart',
            items: toLineItemDocs(input.items),
            currency: input.currency,
            ...totals,
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }
  }

  async createFromBooking(
    organizationId: string,
    userId: string,
    bookingId: string,
  ): Promise<OrderDocument> {
    const existing = await this.ordersRepository.findByBookingId(
      organizationId,
      bookingId,
    );
    if (existing) {
      throw new BadRequestException({
        code: 'ORDER_ALREADY_EXISTS',
        message: 'An order already exists for this booking',
      });
    }

    const booking = await this.bookingsService.getById(
      organizationId,
      bookingId,
    );
    const offer = await this.offersService.getById(
      organizationId,
      booking.offerId.toString(),
    );

    const order = await this.createOrderRecord(organizationId, userId, {
      contactId: booking.contactId.toString(),
      items: [
        {
          offerId: offer.id as string,
          description: offer.name,
          quantity: 1,
          unitPrice: booking.pricing.amount,
        },
      ],
      currency: booking.pricing.currency,
      source: 'booking',
      bookingId,
    });

    return order;
  }

  /**
   * Opens a mutable "tab" — an Order with `status:'open'` and no items yet, to which addItem()
   * can append line items over time (e.g. a restaurant table ordering across a whole seating)
   * before close() freezes it and hands off to the existing pending→confirmed→fulfilled flow
   * unchanged. Generic Order capability, not restaurant-specific — see this feature's own plan
   * for why (packages/types's Resource.type free-form precedent).
   */
  async createOpen(
    organizationId: string,
    userId: string,
    input: {
      contactId: string;
      currency: string;
      bookingId?: string;
      notes?: string;
    },
  ): Promise<OrderDocument> {
    const contactExists = await this.contactsService.existsById(
      organizationId,
      input.contactId,
    );
    if (!contactExists) {
      throw new NotFoundException({
        code: 'CONTACT_NOT_FOUND',
        message: 'Contact not found',
      });
    }
    if (input.bookingId) {
      const existing = await this.ordersRepository.findByBookingId(
        organizationId,
        input.bookingId,
      );
      if (existing) {
        throw new BadRequestException({
          code: 'ORDER_ALREADY_EXISTS',
          message: 'An order already exists for this booking',
        });
      }
    }

    return this.createOrderRecord(organizationId, userId, {
      contactId: input.contactId,
      items: [],
      currency: input.currency,
      notes: input.notes,
      source: 'manual',
      bookingId: input.bookingId,
      status: 'open',
    });
  }

  /** Appends one offer-driven line item to an open order, resolving the offer the same way
   *  createFromCart() does (a financial snapshot of its current name/price, not a live
   *  reference) — Order lines have always stored a snapshot, unlike Cart's live offerId+quantity
   *  pairs. Rejects ORDER_NOT_OPEN once the tab has been closed. */
  async addItem(
    organizationId: string,
    userId: string,
    orderId: string,
    input: { offerId: string; quantity: number },
  ): Promise<OrderDocument> {
    const order = await this.getById(organizationId, orderId);
    if (order.status !== 'open') {
      throw new BadRequestException({
        code: 'ORDER_NOT_OPEN',
        message: 'Items can only be added to an open order',
      });
    }
    const offer = await this.offersService.getById(
      organizationId,
      input.offerId,
    );

    const newItem: LineItemInput = {
      offerId: offer.id as string,
      description: offer.name,
      quantity: input.quantity,
      unitPrice: offer.pricing.amount,
      taxRate: offer.pricing.taxRate,
    };
    const items: LineItemInput[] = [
      ...order.items.map((item) => ({
        offerId: item.offerId?.toString(),
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
      })),
      newItem,
    ];
    const totals = computeTotals(items);

    // Only the newly-added quantity needs reserving — existing items on the tab were already
    // reserved when they were added. Reservation and the item-list write share one transaction,
    // and setItemsIfOpen's null result is checked and thrown INSIDE the transaction (not after
    // it commits) so a concurrently-closed order rolls the stock reservation back too, rather
    // than leaving a phantom reservation with no matching order item.
    const session = await this.connection.startSession();
    let updated: OrderDocument;
    try {
      updated = await session.withTransaction(async () => {
        await this.inventoryService.reserveStock(
          organizationId,
          [{ offerId: newItem.offerId, quantity: newItem.quantity }],
          session,
        );
        const result = await this.ordersRepository.setItemsIfOpen(
          organizationId,
          orderId,
          toLineItemDocs(items),
          totals,
          session,
        );
        if (!result) {
          throw new BadRequestException({
            code: 'ORDER_NOT_OPEN',
            message: 'Items can only be added to an open order',
          });
        }
        return result;
      });
    } finally {
      await session.endSession();
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'order',
      entityId: orderId,
      metadata: { itemAdded: offer.id as string },
    });

    return updated;
  }

  /** Removes one line item by its position in the array. No update-quantity endpoint in v1 —
   *  remove and re-add covers the same need with a smaller API surface. */
  async removeItem(
    organizationId: string,
    userId: string,
    orderId: string,
    itemIndex: number,
  ): Promise<OrderDocument> {
    const order = await this.getById(organizationId, orderId);
    if (order.status !== 'open') {
      throw new BadRequestException({
        code: 'ORDER_NOT_OPEN',
        message: 'Items can only be removed from an open order',
      });
    }
    if (itemIndex < 0 || itemIndex >= order.items.length) {
      throw new NotFoundException({
        code: 'ORDER_ITEM_NOT_FOUND',
        message: 'No item at this index',
      });
    }

    const removedItem = order.items[itemIndex]!;
    const items: LineItemInput[] = order.items
      .filter((_item, i) => i !== itemIndex)
      .map((item) => ({
        offerId: item.offerId?.toString(),
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
      }));
    const totals = computeTotals(items);

    // Same "check inside the transaction, not after" reasoning as addItem — the restock and the
    // item-list write must commit or roll back together.
    const session = await this.connection.startSession();
    let updated: OrderDocument;
    try {
      updated = await session.withTransaction(async () => {
        const result = await this.ordersRepository.setItemsIfOpen(
          organizationId,
          orderId,
          toLineItemDocs(items),
          totals,
          session,
        );
        if (!result) {
          throw new BadRequestException({
            code: 'ORDER_NOT_OPEN',
            message: 'Items can only be removed from an open order',
          });
        }
        await this.inventoryService.restockItems(
          organizationId,
          [
            {
              offerId: removedItem.offerId?.toString(),
              quantity: removedItem.quantity,
            },
          ],
          session,
        );
        return result;
      });
    } finally {
      await session.endSession();
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'order',
      entityId: orderId,
      metadata: { itemRemoved: itemIndex },
    });

    return updated;
  }

  /** Freezes an open tab — from here on the order behaves exactly like any other order created
   *  today (existing confirm/cancel/fulfill/generate-invoice, entirely unmodified). */
  async close(
    organizationId: string,
    userId: string,
    orderId: string,
  ): Promise<OrderDocument> {
    const order = await this.getById(organizationId, orderId);
    if (order.status === 'open' && order.items.length === 0) {
      throw new BadRequestException({
        code: 'ORDER_EMPTY',
        message: 'Cannot close an order with no items',
      });
    }
    return this.transition(
      organizationId,
      userId,
      orderId,
      ['open'],
      'pending',
    );
  }

  /** Called by the public storefront API only — no authenticated user, so no userId to audit. */
  createFromStorefront(
    organizationId: string,
    input: {
      contactId: string;
      items: LineItemInput[];
      currency: string;
      notes?: string;
    },
  ): Promise<OrderDocument> {
    return this.createOrderRecord(organizationId, undefined, {
      contactId: input.contactId,
      items: input.items,
      currency: input.currency,
      notes: input.notes,
      source: 'storefront',
    });
  }

  /**
   * Wraps the counter allocation, stock reservation, and Order insert in one transaction — stock
   * reservation must roll back together with the rest if anything downstream fails, same
   * reasoning as generateInvoiceAtomically. Was a plain non-transactional insert before stock
   * tracking existed; every existing caller (create/createFromBooking/createOpen/
   * createFromStorefront) is unaffected since reserveStock() is a no-op for offers that don't
   * opt into trackStock (which is every offer today except newly-tracked ones).
   */
  private async createOrderRecord(
    organizationId: string,
    userId: string | undefined,
    input: {
      contactId: string;
      items: LineItemInput[];
      currency: string;
      notes?: string;
      source: OrderDocument['source'];
      bookingId?: string;
      /** Defaults to the schema's own default ('pending') when omitted — only createOpen()
       *  passes 'open' explicitly. */
      status?: OrderDocument['status'];
      discountCode?: string;
    },
  ): Promise<OrderDocument> {
    const session = await this.connection.startSession();
    let order: OrderDocument;
    try {
      order = await session.withTransaction(async () => {
        await this.inventoryService.reserveStock(
          organizationId,
          input.items,
          session,
        );

        // Resolved inside the same transaction as the stock reservation: a stock failure below
        // this point would otherwise leave a phantom redemption with no matching order.
        const reservation = input.discountCode
          ? await this.discountCodesService.validateAndReserve(
              organizationId,
              input.discountCode,
              {
                offerIds: input.items
                  .map((item) => item.offerId)
                  .filter((id): id is string => !!id),
              },
              session,
            )
          : undefined;
        const totals = computeTotals(input.items, reservation?.resolved);

        const number = await this.countersService.nextFormatted(
          organizationId,
          'order',
          'CMD',
        );

        return this.ordersRepository.create(
          {
            organizationId: new Types.ObjectId(organizationId),
            contactId: new Types.ObjectId(input.contactId),
            number,
            source: input.source,
            status: input.status,
            bookingId: input.bookingId
              ? new Types.ObjectId(input.bookingId)
              : undefined,
            items: toLineItemDocs(input.items),
            currency: input.currency,
            ...totals,
            discountCodeId: reservation
              ? new Types.ObjectId(reservation.discountCodeId)
              : undefined,
            notes: input.notes,
          },
          session,
        );
      });
    } finally {
      await session.endSession();
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'order',
      entityId: order.id as string,
      metadata: { source: input.source },
    });

    await this.eventBus.publish(organizationId, 'order.created', {
      orderId: order.id as string,
      contactId: input.contactId,
      total: order.total,
      source: input.source,
    });

    return order;
  }

  async getById(organizationId: string, id: string): Promise<OrderDocument> {
    const order = await this.ordersRepository.findById(organizationId, id);
    if (!order) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }
    return order;
  }

  async list(
    organizationId: string,
    query: FindOrdersOptions,
  ): Promise<{ data: OrderDocument[]; pagination: Pagination }> {
    const { data, total } = await this.ordersRepository.findAll(
      organizationId,
      query,
    );
    return {
      data,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async confirm(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<OrderDocument> {
    return this.transition(
      organizationId,
      userId,
      id,
      ['pending'],
      'confirmed',
    );
  }

  /**
   * Cancel is the one status transition that must restock every reserved item, so unlike
   * confirm/fulfill it doesn't go through the plain transition() helper — the status write and
   * the restock share one transaction (order.items is read from the already-fetched `order`
   * before the transaction starts, which is safe here: items on a non-open order are immutable,
   * unlike the open-tab case addItem/removeItem guard against).
   */
  async cancel(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<OrderDocument> {
    const order = await this.getById(organizationId, id);
    if (!['pending', 'confirmed'].includes(order.status)) {
      throw new BadRequestException({
        code: 'ORDER_INVALID_TRANSITION',
        message: `Cannot move order from "${order.status}" to "cancelled"`,
      });
    }

    const session = await this.connection.startSession();
    let updated: OrderDocument;
    try {
      updated = await session.withTransaction(async () => {
        const result = await this.ordersRepository.update(
          organizationId,
          id,
          { status: 'cancelled' },
          session,
        );
        if (!result) {
          throw new NotFoundException({
            code: 'ORDER_NOT_FOUND',
            message: 'Order not found',
          });
        }
        await this.inventoryService.restockItems(
          organizationId,
          result.items.map((item) => ({
            offerId: item.offerId?.toString(),
            quantity: item.quantity,
          })),
          session,
        );
        await this.discountCodesService.releaseIfApplied(
          organizationId,
          result.discountCodeId?.toString(),
          session,
        );
        return result;
      });
    } finally {
      await session.endSession();
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'order',
      entityId: id,
      metadata: { status: 'cancelled' },
    });

    return updated;
  }

  async fulfill(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<OrderDocument> {
    const order = await this.transition(
      organizationId,
      userId,
      id,
      ['confirmed'],
      'fulfilled',
    );
    await this.fulfillmentsService.createForOrder(organizationId, id);
    return order;
  }

  private async transition(
    organizationId: string,
    userId: string,
    id: string,
    allowedFrom: OrderDocument['status'][],
    to: OrderDocument['status'],
  ): Promise<OrderDocument> {
    const order = await this.getById(organizationId, id);
    if (!allowedFrom.includes(order.status)) {
      throw new BadRequestException({
        code: 'ORDER_INVALID_TRANSITION',
        message: `Cannot move order from "${order.status}" to "${to}"`,
      });
    }

    const updated = await this.ordersRepository.update(organizationId, id, {
      status: to,
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'order',
      entityId: id,
      metadata: { status: to },
    });

    return updated;
  }

  async generateInvoice(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<InvoiceDocument> {
    const order = await this.getById(organizationId, id);
    if (order.invoiceId) {
      throw new BadRequestException({
        code: 'ORDER_ALREADY_INVOICED',
        message: 'An invoice already exists for this order',
      });
    }
    if (order.status !== 'confirmed' && order.status !== 'fulfilled') {
      throw new BadRequestException({
        code: 'ORDER_NOT_INVOICEABLE',
        message: 'Only a confirmed or fulfilled order can be invoiced',
      });
    }

    const invoice = await this.generateInvoiceAtomically(organizationId, id, {
      contactId: order.contactId.toString(),
      orderId: order.id as string,
      currency: order.currency,
      items: order.items.map((item) => ({
        offerId: item.offerId?.toString(),
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
      })),
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'invoice',
      entityId: invoice.id as string,
      metadata: { orderId: id },
    });

    return invoice;
  }

  /**
   * Invoice.create() + Order.invoiceId update, in a single MongoDB transaction: either both
   * writes commit, or neither does — closing the crash-between-writes gap identified by the
   * audit (Invoice created with Order.invoiceId left empty, or a retry creating a second
   * Invoice for the same order).
   *
   * Concurrency: the Order update is conditioned on `invoiceId: { $exists: false }` (see
   * OrdersRepository.attachInvoiceIfUnset) — evaluated by MongoDB at write time, not from the
   * `order` snapshot read moments earlier by the caller. But that guard runs AFTER the Invoice
   * insert, so it alone cannot stop two concurrent transactions from each successfully
   * inserting their own Invoice before either reaches it — which is exactly what the partial
   * unique index on Invoice.orderId is for: it's the mechanism that actually stops the second
   * insert (confirmed by e2e testing against real concurrent requests — the second attempt
   * fails at the Invoice insert with a MongoDB duplicate-key error, not at the Order update).
   * That duplicate-key error is caught below and mapped to the same ORDER_ALREADY_INVOICED the
   * Order guard produces, so both race outcomes converge on one API contract. The Order guard
   * remains necessary in its own right for the case where the index doesn't fire — i.e. the
   * Invoice insert succeeds (no conflict) but a second transaction is already mid-flight for
   * the same order.
   */
  private async generateInvoiceAtomically(
    organizationId: string,
    orderId: string,
    input: {
      contactId: string;
      orderId: string;
      currency: string;
      items: LineItemInput[];
    },
  ): Promise<InvoiceDocument> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(async () => {
        let invoice: InvoiceDocument;
        try {
          invoice = await this.invoicesService.createFromOrder(
            organizationId,
            input,
            session,
          );
        } catch (error) {
          if (isDuplicateOrderIdError(error)) {
            throw new BadRequestException({
              code: 'ORDER_ALREADY_INVOICED',
              message: 'An invoice already exists for this order',
            });
          }
          throw error;
        }

        const updatedOrder = await this.ordersRepository.attachInvoiceIfUnset(
          organizationId,
          orderId,
          invoice.id as string,
          session,
        );
        if (!updatedOrder) {
          throw new BadRequestException({
            code: 'ORDER_ALREADY_INVOICED',
            message: 'An invoice already exists for this order',
          });
        }

        return invoice;
      });
    } finally {
      await session.endSession();
    }
  }

  /**
   * Closes the "Réservation → Paiement" loop the Business OS audit flagged as PARTIELLE
   * (docs/BUSINESS_OS_AUDIT.md §2): `Booking.paymentStatus` was write-once-at-creation
   * ('unpaid') and never updated again, even once the booking's Order was fully invoiced and
   * paid through the real Payment pipeline. Called from EventsProcessor on every
   * `payment.completed` event — not every Invoice traces back to a booking-sourced Order (most
   * don't), so a miss here (no matching Order, or an Order with no `bookingId`) is the expected,
   * silent common case, not an error.
   *
   * Never throws: this is a best-effort derived-state sync reacting to an event, not a user
   * request — a transient failure here must never surface as a failed payment or retry-storm the
   * whole event job (same philosophy as DecisionEngineService.handleEvent, see that class's own
   * comment). The next `payment.completed` for the same invoice (e.g. a later installment) will
   * simply re-derive the correct status from the Invoice's current `amountPaid`/`status` anyway.
   */
  async syncBookingPaymentStatusFromInvoice(
    organizationId: string,
    invoiceId: string,
  ): Promise<void> {
    try {
      const order = await this.ordersRepository.findByInvoiceId(
        organizationId,
        invoiceId,
      );
      if (!order?.bookingId) return;

      const invoice = await this.invoicesService.getById(
        organizationId,
        invoiceId,
      );
      const paymentStatus =
        invoice.status === 'paid'
          ? 'paid'
          : invoice.amountPaid > 0
            ? 'deposit_paid'
            : 'unpaid';

      await this.bookingsService.syncPaymentStatus(
        organizationId,
        order.bookingId.toString(),
        paymentStatus,
      );
    } catch (error) {
      this.logger.error(
        `Failed to sync Booking.paymentStatus from Invoice ${invoiceId}`,
        error,
      );
    }
  }
}

/**
 * True for the MongoDB duplicate-key error (code 11000) raised by the partial unique index on
 * Invoice.orderId specifically — narrowed by index name in the driver's error message so an
 * unrelated unique-index collision (e.g. the invoice `number` sequence, practically impossible
 * given its atomic counter, but not a case this should silently swallow) is rethrown as-is.
 */
function isDuplicateOrderIdError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as Record<string, unknown>;
  return (
    code === 11000 && typeof message === 'string' && message.includes('orderId')
  );
}
