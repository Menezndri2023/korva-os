import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { Pagination } from '@korva/types';
import type { CreateReturnRequestInput } from '@korva/validation';
import {
  ReturnRequestsRepository,
  FindReturnRequestsOptions,
} from './return-requests.repository';
import { ReturnRequestDocument } from './schemas/return-request.schema';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../../finance/payments/payments.service';
import { InventoryService } from '../../catalog/offers/inventory.service';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';

/**
 * A customer or staff member can request a return on any line item of an already-fulfilled
 * Order. Approving one triggers a real refund through the existing Payments/Refund pipeline
 * (never a new refund mechanism) and restocks tracked-stock offers involved — rejecting one
 * does neither. See the schema's own doc comment for why quantities are tracked by line-item
 * index rather than offerId alone.
 */
@Injectable()
export class ReturnRequestsService {
  constructor(
    private readonly returnRequestsRepository: ReturnRequestsRepository,
    private readonly ordersService: OrdersService,
    private readonly paymentsService: PaymentsService,
    private readonly inventoryService: InventoryService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
  ) {}

  /**
   * `expectedContactId`, when given, must match the order's own contact — the customer-portal
   * caller passes its authenticated contactId here so a customer can never file a return
   * against another customer's order. A staff caller omits it entirely: any staff member with
   * `returns.create` may file a return for any of the organization's orders, and the return is
   * always attributed to the order's actual contact regardless of which path created it.
   */
  async create(
    organizationId: string,
    input: CreateReturnRequestInput,
    expectedContactId?: string,
  ): Promise<ReturnRequestDocument> {
    const order = await this.ordersService.getById(
      organizationId,
      input.orderId,
    );
    if (expectedContactId && order.contactId.toString() !== expectedContactId) {
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }
    const contactId = order.contactId.toString();
    if (order.status !== 'fulfilled') {
      throw new BadRequestException({
        code: 'RETURN_ORDER_NOT_FULFILLED',
        message: 'Only a fulfilled order can be returned',
      });
    }

    const alreadyApproved =
      await this.returnRequestsRepository.findApprovedByOrderId(
        organizationId,
        input.orderId,
      );
    const returnedQuantityByIndex = new Map<number, number>();
    for (const request of alreadyApproved) {
      for (const item of request.items) {
        returnedQuantityByIndex.set(
          item.lineItemIndex,
          (returnedQuantityByIndex.get(item.lineItemIndex) ?? 0) +
            item.quantity,
        );
      }
    }

    let refundAmount = 0;
    const items = input.items.map(({ lineItemIndex, quantity }) => {
      const lineItem = order.items[lineItemIndex];
      if (!lineItem) {
        throw new BadRequestException({
          code: 'RETURN_INVALID_LINE_ITEM',
          message: `Order has no line item at index ${lineItemIndex}`,
        });
      }
      const alreadyReturned = returnedQuantityByIndex.get(lineItemIndex) ?? 0;
      if (quantity + alreadyReturned > lineItem.quantity) {
        throw new BadRequestException({
          code: 'RETURN_QUANTITY_EXCEEDS_ORDERED',
          message: `Cannot return ${quantity} of line item ${lineItemIndex} — only ${
            lineItem.quantity - alreadyReturned
          } remain returnable`,
        });
      }
      refundAmount += quantity * lineItem.unitPrice;
      return {
        lineItemIndex,
        offerId: lineItem.offerId,
        variantId: lineItem.variantId,
        description: lineItem.description,
        quantity,
        unitPrice: lineItem.unitPrice,
      };
    });

    const returnRequest = await this.returnRequestsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      orderId: new Types.ObjectId(input.orderId),
      contactId: new Types.ObjectId(contactId),
      items,
      reason: input.reason,
      status: 'pending',
      refundAmount: Math.round(refundAmount * 100) / 100,
      currency: order.currency,
    });

    await this.eventBus.publish(organizationId, 'return_request.created', {
      returnRequestId: returnRequest.id as string,
      contactId,
    });

    return returnRequest;
  }

  async getById(
    organizationId: string,
    id: string,
  ): Promise<ReturnRequestDocument> {
    const returnRequest = await this.returnRequestsRepository.findById(
      organizationId,
      id,
    );
    if (!returnRequest) {
      throw new NotFoundException({
        code: 'RETURN_REQUEST_NOT_FOUND',
        message: 'Return request not found',
      });
    }
    return returnRequest;
  }

  async list(
    organizationId: string,
    query: FindReturnRequestsOptions,
  ): Promise<{ data: ReturnRequestDocument[]; pagination: Pagination }> {
    const { data, total } = await this.returnRequestsRepository.findAll(
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

  /**
   * Transitions pending -> approved atomically FIRST (so a concurrent second approval attempt
   * is rejected outright, never double-refunded), then triggers the real refund. If the refund
   * step itself fails for any reason (no refundable payment, provider error, ...) the request is
   * rolled back to 'pending' so it can be investigated/retried rather than left stuck "approved"
   * with no actual refund behind it — the one case that must never happen is the reverse: an
   * order left 'approved' where money never moved.
   */
  async approve(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<ReturnRequestDocument> {
    const claimed = await this.returnRequestsRepository.markApproved(
      organizationId,
      id,
      userId,
    );
    if (!claimed) {
      const existing = await this.returnRequestsRepository.findById(
        organizationId,
        id,
      );
      if (!existing) {
        throw new NotFoundException({
          code: 'RETURN_REQUEST_NOT_FOUND',
          message: 'Return request not found',
        });
      }
      throw new BadRequestException({
        code: 'RETURN_REQUEST_ALREADY_REVIEWED',
        message: `This return request has already been ${existing.status}`,
      });
    }

    try {
      const order = await this.ordersService.getById(
        organizationId,
        claimed.orderId.toString(),
      );
      if (!order.invoiceId) {
        throw new BadRequestException({
          code: 'RETURN_ORDER_NOT_INVOICED',
          message: 'This order has no invoice to refund against',
        });
      }
      const payment = await this.paymentsService.findCompletedPaymentForInvoice(
        organizationId,
        order.invoiceId.toString(),
      );
      if (!payment) {
        throw new BadRequestException({
          code: 'RETURN_NO_REFUNDABLE_PAYMENT',
          message: 'No completed payment was found to refund for this order',
        });
      }

      const refund = await this.paymentsService.refund(
        organizationId,
        userId,
        {
          paymentId: payment.id as string,
          amount: claimed.refundAmount,
          reason: `Retour: ${claimed.reason}`,
        },
        `return:${id}`,
      );

      await this.inventoryService.restockItems(
        organizationId,
        claimed.items
          .filter((item) => item.offerId)
          .map((item) => ({
            offerId: item.offerId!.toString(),
            variantId: item.variantId,
            quantity: item.quantity,
          })),
      );

      const updated = await this.returnRequestsRepository.setRefundId(
        organizationId,
        id,
        refund.id as string,
      );

      await this.auditService.record({
        organizationId,
        userId,
        action: 'UPDATE',
        entity: 'return_request',
        entityId: id,
        metadata: { status: 'approved', refundId: refund.id },
      });
      await this.eventBus.publish(organizationId, 'return_request.approved', {
        returnRequestId: id,
        contactId: claimed.contactId.toString(),
      });

      return updated ?? claimed;
    } catch (error) {
      await this.returnRequestsRepository.revertToPending(organizationId, id);
      throw error;
    }
  }

  async reject(
    organizationId: string,
    userId: string,
    id: string,
    reason: string | undefined,
  ): Promise<ReturnRequestDocument> {
    const updated = await this.returnRequestsRepository.reject(
      organizationId,
      id,
      userId,
      reason,
    );
    if (!updated) {
      const existing = await this.returnRequestsRepository.findById(
        organizationId,
        id,
      );
      if (!existing) {
        throw new NotFoundException({
          code: 'RETURN_REQUEST_NOT_FOUND',
          message: 'Return request not found',
        });
      }
      throw new BadRequestException({
        code: 'RETURN_REQUEST_ALREADY_REVIEWED',
        message: `This return request has already been ${existing.status}`,
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'return_request',
      entityId: id,
      metadata: { status: 'rejected' },
    });
    await this.eventBus.publish(organizationId, 'return_request.rejected', {
      returnRequestId: id,
      contactId: updated.contactId.toString(),
    });

    return updated;
  }
}
