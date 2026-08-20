import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { OrdersService } from '../../commerce/orders/orders.service';

const inputSchema = z.object({ orderId: z.string().min(1) });

@Injectable()
export class GetOrderTool implements AiTool<z.infer<typeof inputSchema>> {
  readonly definition = {
    name: 'get_order',
    description: "Récupère les détails d'une commande par son id.",
    inputSchema: {
      type: 'object',
      properties: { orderId: { type: 'string' } },
      required: ['orderId'],
    },
  };
  readonly requiredPermission = 'orders.read' as const;
  readonly auditEntity = 'order';

  constructor(private readonly ordersService: OrdersService) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  async execute(
    organizationId: string,
    _userId: string,
    input: z.infer<typeof inputSchema>,
  ) {
    const order = await this.ordersService.getById(
      organizationId,
      input.orderId,
    );
    return {
      id: order.id as string,
      number: order.number,
      status: order.status,
      total: order.total,
      currency: order.currency,
      source: order.source,
    };
  }
}
