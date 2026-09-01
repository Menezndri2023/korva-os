import {
  BadRequestException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { KitchenTicketStatus, KitchenTicketWithOrder } from '@korva/types';
import { KitchenTicketsRepository } from './kitchen-tickets.repository';
import { KitchenTicketDocument } from './schemas/kitchen-ticket.schema';
import { KitchenGateway } from './kitchen.gateway';
import { OrdersService } from '../orders/orders.service';
import { AuditService } from '../../audit/audit.service';

const ADVANCE_SEQUENCE: KitchenTicketStatus[] = [
  'new',
  'preparing',
  'ready',
  'served',
];

@Injectable()
export class KitchenTicketsService {
  constructor(
    private readonly kitchenTicketsRepository: KitchenTicketsRepository,
    // See orders.service.ts's matching forwardRef for why this pair is circular.
    @Inject(forwardRef(() => OrdersService))
    private readonly ordersService: OrdersService,
    private readonly kitchenGateway: KitchenGateway,
    private readonly auditService: AuditService,
  ) {}

  /** Called from OrdersService.createOpen() — every open tab gets a ticket immediately, even
   *  before it has any items, so the kitchen display shows a table the moment it's seated. */
  async ensureTicketForOrder(
    organizationId: string,
    orderId: string,
    resourceId?: string,
  ): Promise<void> {
    await this.kitchenTicketsRepository.findOrCreateForOrder(
      organizationId,
      orderId,
      resourceId,
    );
    this.kitchenGateway.broadcastChange(organizationId);
  }

  /** Called from OrdersService.addItem() — a ticket the kitchen already marked 'ready'/'served'
   *  reverts to 'new' when something new lands on the tab, so it doesn't get missed. A ticket
   *  still 'new' or 'preparing' is left alone; the new item just joins what's already being
   *  worked. Silently does nothing if the order has no ticket (not every order is an open tab —
   *  see this class's own module-level scope note). */
  async handleItemsChanged(
    organizationId: string,
    orderId: string,
  ): Promise<void> {
    const ticket = await this.kitchenTicketsRepository.findByOrderId(
      organizationId,
      orderId,
    );
    if (!ticket) return;
    if (ticket.status === 'ready' || ticket.status === 'served') {
      await this.kitchenTicketsRepository.updateStatus(
        organizationId,
        ticket.id as string,
        'new',
      );
    }
    this.kitchenGateway.broadcastChange(organizationId);
  }

  /** Called from OrdersService.cancel() — a cancelled order's ticket disappears from the active
   *  kitchen view (list() excludes 'cancelled' by default). */
  async handleOrderCancelled(
    organizationId: string,
    orderId: string,
  ): Promise<void> {
    const ticket = await this.kitchenTicketsRepository.findByOrderId(
      organizationId,
      orderId,
    );
    if (!ticket) return;
    await this.kitchenTicketsRepository.updateStatus(
      organizationId,
      ticket.id as string,
      'cancelled',
    );
    this.kitchenGateway.broadcastChange(organizationId);
  }

  /** Joins each ticket with its order's live items — the ticket alone has nothing to render.
   *  Defaults to the active statuses (excludes served/cancelled) so the display only shows
   *  what the kitchen still needs to act on; pass `status` to see a specific one instead. */
  async list(
    organizationId: string,
    status?: KitchenTicketStatus,
  ): Promise<KitchenTicketWithOrder[]> {
    const tickets = await this.kitchenTicketsRepository.findAll(
      organizationId,
      status,
    );
    const active = status
      ? tickets
      : tickets.filter(
          (t) => t.status !== 'served' && t.status !== 'cancelled',
        );

    const results: KitchenTicketWithOrder[] = [];
    for (const ticket of active) {
      const order = await this.ordersService.getById(
        organizationId,
        ticket.orderId.toString(),
      );
      results.push({
        ticket: {
          id: ticket.id as string,
          organizationId,
          orderId: order.id as string,
          resourceId: ticket.resourceId?.toString(),
          status: ticket.status,
          createdAt: (
            ticket as unknown as { createdAt: Date }
          ).createdAt.toISOString(),
          updatedAt: (
            ticket as unknown as { updatedAt: Date }
          ).updatedAt.toISOString(),
        },
        order: {
          id: order.id as string,
          number: order.number,
          items: order.items.map((item) => ({
            description: item.description,
            quantity: item.quantity,
          })),
          createdAt: (
            order as unknown as { createdAt: Date }
          ).createdAt.toISOString(),
        },
      });
    }
    return results;
  }

  async advance(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<KitchenTicketDocument> {
    const ticket = await this.kitchenTicketsRepository.findById(
      organizationId,
      id,
    );
    if (!ticket) {
      throw new NotFoundException({
        code: 'KITCHEN_TICKET_NOT_FOUND',
        message: 'Kitchen ticket not found',
      });
    }
    const currentIndex = ADVANCE_SEQUENCE.indexOf(ticket.status);
    if (currentIndex === -1 || currentIndex === ADVANCE_SEQUENCE.length - 1) {
      throw new BadRequestException({
        code: 'KITCHEN_TICKET_INVALID_TRANSITION',
        message: `Cannot advance a ticket with status "${ticket.status}"`,
      });
    }
    const nextStatus = ADVANCE_SEQUENCE[currentIndex + 1]!;

    const updated = await this.kitchenTicketsRepository.updateStatus(
      organizationId,
      id,
      nextStatus,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'KITCHEN_TICKET_NOT_FOUND',
        message: 'Kitchen ticket not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'kitchen_ticket',
      entityId: id,
      metadata: { status: nextStatus },
    });
    this.kitchenGateway.broadcastChange(organizationId);

    return updated;
  }
}
