import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { CreateOrderInput, LineItemInput } from '@korva/validation';
import type { Pagination } from '@korva/types';
import { OrdersRepository, FindOrdersOptions } from './orders.repository';
import { OrderDocument } from './schemas/order.schema';
import { CartsRepository } from '../carts/carts.repository';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { OffersService } from '../../catalog/offers/offers.service';
import { BookingsService } from '../../booking/bookings/bookings.service';
import { InvoicesService } from '../../finance/invoices/invoices.service';
import { InvoiceDocument } from '../../finance/invoices/schemas/invoice.schema';
import { FulfillmentsService } from '../fulfillments/fulfillments.service';
import { CountersService } from '../../core/counters/counters.service';
import { AuditService } from '../../audit/audit.service';
import { computeTotals, toLineItemDocs } from '../../shared/line-item.schema';

@Injectable()
export class OrdersService {
  constructor(
    private readonly ordersRepository: OrdersRepository,
    private readonly cartsRepository: CartsRepository,
    private readonly contactsService: ContactsService,
    private readonly offersService: OffersService,
    private readonly bookingsService: BookingsService,
    private readonly invoicesService: InvoicesService,
    private readonly fulfillmentsService: FulfillmentsService,
    private readonly countersService: CountersService,
    private readonly auditService: AuditService,
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

    const offers = await Promise.all(
      cart.items.map((item) =>
        this.offersService.getById(organizationId, item.offerId.toString()),
      ),
    );
    const currency = offers[0]?.pricing.currency ?? 'EUR';
    const items = cart.items.map((item, index) => ({
      offerId: item.offerId.toString(),
      description: offers[index]!.name,
      quantity: item.quantity,
      unitPrice: offers[index]!.pricing.amount,
      taxRate: offers[index]!.pricing.taxRate,
    }));

    const order = await this.createOrderRecord(organizationId, userId, {
      contactId: cart.contactId.toString(),
      items,
      currency,
      source: 'cart',
    });

    await this.cartsRepository.markConverted(organizationId, cartId);

    return order;
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

  private async createOrderRecord(
    organizationId: string,
    userId: string,
    input: {
      contactId: string;
      items: LineItemInput[];
      currency: string;
      notes?: string;
      source: OrderDocument['source'];
      bookingId?: string;
    },
  ): Promise<OrderDocument> {
    const totals = computeTotals(input.items);
    const number = await this.countersService.nextFormatted(
      organizationId,
      'order',
      'CMD',
    );

    const order = await this.ordersRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      contactId: new Types.ObjectId(input.contactId),
      number,
      source: input.source,
      bookingId: input.bookingId
        ? new Types.ObjectId(input.bookingId)
        : undefined,
      items: toLineItemDocs(input.items),
      currency: input.currency,
      ...totals,
      notes: input.notes,
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'order',
      entityId: order.id as string,
      metadata: { source: input.source },
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

  async cancel(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<OrderDocument> {
    return this.transition(
      organizationId,
      userId,
      id,
      ['pending', 'confirmed'],
      'cancelled',
    );
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

    const invoice = await this.invoicesService.createFromOrder(
      organizationId,
      userId,
      {
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
      },
    );

    await this.ordersRepository.update(organizationId, id, {
      invoiceId: new Types.ObjectId(invoice.id as string),
    });

    return invoice;
  }
}
