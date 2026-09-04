import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type {
  CreatePurchaseOrderInput,
  ListPurchaseOrdersQuery,
} from '@korva/validation';
import type { Pagination } from '@korva/types';
import { PurchaseOrdersRepository } from './purchase-orders.repository';
import { SuppliersService } from './suppliers.service';
import { OffersService } from '../offers/offers.service';
import { PurchaseOrderDocument } from './schemas/purchase-order.schema';
import { OfferDocument } from '../offers/schemas/offer.schema';
import { AuditService } from '../../audit/audit.service';

function variantName(offer: OfferDocument, variantId?: string): string {
  if (!variantId) return offer.name;
  const variant = offer.variants.find(
    (v) =>
      (v as unknown as { _id: Types.ObjectId })._id.toString() === variantId,
  );
  if (!variant) {
    throw new NotFoundException({
      code: 'OFFER_VARIANT_NOT_FOUND',
      message: 'Variant not found on this offer',
    });
  }
  return `${offer.name} — ${variant.name}`;
}

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly purchaseOrdersRepository: PurchaseOrdersRepository,
    private readonly suppliersService: SuppliersService,
    private readonly offersService: OffersService,
    private readonly auditService: AuditService,
  ) {}

  /**
   * Snapshots each line's offer/variant name and validates every offer resolves and shares one
   * currency — a PO mixing currencies would have no single meaningful "total", same invariant
   * TimeEntriesService.generateInvoice already enforces for its own batch operation
   * (TIME_ENTRIES_MIXED_CURRENCY), just at creation time instead of at a later conversion step.
   */
  async create(
    organizationId: string,
    userId: string,
    input: CreatePurchaseOrderInput,
  ): Promise<PurchaseOrderDocument> {
    await this.suppliersService.getById(organizationId, input.supplierId);

    const offerIds = [...new Set(input.items.map((item) => item.offerId))];
    const offersById = await this.offersService.getManyByIds(
      organizationId,
      offerIds,
    );

    const currencies = new Set(
      offerIds.map((id) => offersById.get(id)!.pricing.currency),
    );
    if (currencies.size > 1) {
      throw new BadRequestException({
        code: 'PURCHASE_ORDER_MIXED_CURRENCY',
        message:
          'All line items on a purchase order must share the same currency',
      });
    }
    const currency = [...currencies][0]!;

    const items = input.items.map((item) => {
      const offer = offersById.get(item.offerId)!;
      return {
        offerId: new Types.ObjectId(item.offerId),
        variantId: item.variantId
          ? new Types.ObjectId(item.variantId)
          : undefined,
        name: variantName(offer, item.variantId),
        quantity: item.quantity,
        unitCost: item.unitCost,
      };
    });

    const purchaseOrder = await this.purchaseOrdersRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      supplierId: new Types.ObjectId(input.supplierId),
      items,
      currency,
      expectedDate: input.expectedDate
        ? new Date(input.expectedDate)
        : undefined,
      notes: input.notes,
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'purchase_order',
      entityId: purchaseOrder.id as string,
    });

    return purchaseOrder;
  }

  async findAll(
    organizationId: string,
    query: ListPurchaseOrdersQuery,
  ): Promise<{ data: PurchaseOrderDocument[]; pagination: Pagination }> {
    const { data, total } = await this.purchaseOrdersRepository.findAll(
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

  async getById(
    organizationId: string,
    id: string,
  ): Promise<PurchaseOrderDocument> {
    const purchaseOrder = await this.purchaseOrdersRepository.findById(
      organizationId,
      id,
    );
    if (!purchaseOrder) {
      throw new NotFoundException({
        code: 'PURCHASE_ORDER_NOT_FOUND',
        message: 'Purchase order not found',
      });
    }
    return purchaseOrder;
  }

  async markOrdered(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<PurchaseOrderDocument> {
    const updated = await this.purchaseOrdersRepository.transition(
      organizationId,
      id,
      ['draft'],
      'ordered',
    );
    if (!updated) {
      await this.assertExistsForConflict(organizationId, id);
      throw new BadRequestException({
        code: 'PURCHASE_ORDER_NOT_DRAFT',
        message: 'Only a draft purchase order can be marked as ordered',
      });
    }
    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'purchase_order',
      entityId: id,
      metadata: { status: 'ordered' },
    });
    return updated;
  }

  async cancel(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<PurchaseOrderDocument> {
    const updated = await this.purchaseOrdersRepository.transition(
      organizationId,
      id,
      ['draft', 'ordered'],
      'cancelled',
    );
    if (!updated) {
      await this.assertExistsForConflict(organizationId, id);
      throw new BadRequestException({
        code: 'PURCHASE_ORDER_NOT_CANCELLABLE',
        message: 'Only a draft or ordered purchase order can be cancelled',
      });
    }
    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'purchase_order',
      entityId: id,
      metadata: { status: 'cancelled' },
    });
    return updated;
  }

  /**
   * Receiving is the only transition that touches stock: one `recordStockMovement('received')`
   * call per line, each an independent atomic single-document write (see InventoryService's own
   * per-line reasoning) — NOT wrapped in a single cross-line transaction. To keep the common
   * failure mode (an offer's trackStock got disabled after the PO was created) from applying half
   * a delivery, every line is pre-checked with trackStock still enabled before any stock is
   * touched; a genuine failure mid-loop (e.g. a concurrent delete) would still leave a partial
   * application — an accepted v1 gap, documented rather than solved with a bigger transactional
   * rewrite, matching this codebase's precedent (CohortsService.scheduleSession).
   */
  async receive(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<PurchaseOrderDocument> {
    const purchaseOrder = await this.getById(organizationId, id);
    if (purchaseOrder.status !== 'ordered') {
      throw new BadRequestException({
        code: 'PURCHASE_ORDER_NOT_ORDERED',
        message: 'Only an ordered purchase order can be received',
      });
    }

    const offerIds = [
      ...new Set(purchaseOrder.items.map((item) => item.offerId.toString())),
    ];
    const offersById = await this.offersService.getManyByIds(
      organizationId,
      offerIds,
    );
    const untracked = offerIds.find(
      (offerId) => !offersById.get(offerId)!.trackStock,
    );
    if (untracked) {
      throw new BadRequestException({
        code: 'STOCK_TRACKING_NOT_ENABLED',
        message:
          'Every offer on this purchase order must have stock tracking enabled to be received',
      });
    }

    for (const item of purchaseOrder.items) {
      await this.offersService.recordStockMovement(
        organizationId,
        userId,
        item.offerId.toString(),
        {
          type: 'received',
          quantity: item.quantity,
          variantId: item.variantId?.toString(),
          reason: `Purchase order ${id}`,
        },
      );
    }

    const updated = await this.purchaseOrdersRepository.transition(
      organizationId,
      id,
      ['ordered'],
      'received',
      { receivedAt: new Date() },
    );
    if (!updated) {
      throw new BadRequestException({
        code: 'PURCHASE_ORDER_NOT_ORDERED',
        message: 'Only an ordered purchase order can be received',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'purchase_order',
      entityId: id,
      metadata: { status: 'received' },
    });
    return updated;
  }

  private async assertExistsForConflict(
    organizationId: string,
    id: string,
  ): Promise<void> {
    await this.getById(organizationId, id);
  }
}
