import { createOrderSchema, type CreateOrderInput } from '@korva/validation';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { OrdersService } from '../../commerce/orders/orders.service';

@Injectable()
export class CreateOrderTool implements AiTool<CreateOrderInput> {
  readonly definition = {
    name: 'create_order',
    description:
      'Crée une commande manuelle pour un contact, avec une ou plusieurs lignes.',
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
