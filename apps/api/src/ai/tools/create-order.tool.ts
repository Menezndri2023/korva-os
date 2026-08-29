import { createOrderSchema, type CreateOrderInput } from '@korva/validation';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { OrdersService } from '../../commerce/orders/orders.service';

/**
 * Sensitive (docs/BUSINESS_OS_AUDIT.md roadmap item #6): an order is a real financial
 * commitment on the organization's behalf — exactly the "engagements financiers" category the
 * Business OS brief (§6) says the AI must never act on unsupervised. Unlike create_quote (a
 * draft the customer hasn't agreed to anything on), a created Order is expected to be fulfilled/
 * invoiced.
 */
@Injectable()
export class CreateOrderTool implements AiTool<CreateOrderInput> {
  readonly definition = {
    name: 'create_order',
    description:
      'Crée une commande manuelle pour un contact, avec une ou plusieurs lignes. Nécessite une confirmation humaine.',
    inputSchema: {
      type: 'object',
      properties: {
        contactId: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              offerId: { type: 'string' },
              description: { type: 'string' },
              quantity: { type: 'number' },
              unitPrice: { type: 'number' },
              taxRate: { type: 'number' },
            },
            required: ['description', 'quantity', 'unitPrice'],
          },
        },
        currency: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['contactId', 'items', 'currency'],
    },
  };
  readonly requiredPermission = 'orders.create' as const;
  readonly sensitive = true;
  readonly auditEntity = 'order';

  constructor(private readonly ordersService: OrdersService) {}

  parseInput(raw: unknown) {
    return createOrderSchema.parse(raw);
  }

  async execute(
    organizationId: string,
    userId: string,
    input: CreateOrderInput,
  ) {
    const order = await this.ordersService.create(
      organizationId,
      userId,
      input,
    );
    return {
      id: order.id as string,
      number: order.number,
      total: order.total,
      status: order.status,
    };
  }
}
