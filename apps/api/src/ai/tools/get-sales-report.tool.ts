import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AiTool } from './tool.interface';
import {
  Order,
  OrderDocument,
} from '../../commerce/orders/schemas/order.schema';

const inputSchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

interface SalesSummary {
  totalRevenue: number;
  orderCount: number;
}
interface TopOfferAggregate {
  _id: string;
  revenue: number;
}

/**
 * Minimal read-only aggregation over Orders — deliberately scoped to the AI module rather
 * than a full standalone Analytics module (not a numbered phase in the brief). See
 * docs/IMPLEMENTATION_PLAN.md Phase 9.
 */
@Injectable()
export class GetSalesReportTool implements AiTool<z.infer<typeof inputSchema>> {
  readonly definition = {
    name: 'get_sales_report',
    description:
      "Rapport de ventes : chiffre d'affaires total, nombre de commandes, top des offres, sur une période optionnelle.",
    inputSchema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'Date/heure ISO 8601 de début (optionnel)',
        },
        to: {
          type: 'string',
          description: 'Date/heure ISO 8601 de fin (optionnel)',
        },
      },
    },
  };
  readonly requiredPermission = 'orders.read' as const;
  readonly auditEntity = 'sales_report';

  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
  ) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  async execute(
    organizationId: string,
    _userId: string,
    input: z.infer<typeof inputSchema>,
  ) {
    const match: Record<string, unknown> = {
      organizationId: new Types.ObjectId(organizationId),
      status: { $in: ['confirmed', 'fulfilled'] },
    };
    if (input.from || input.to) {
      const createdAt: Record<string, Date> = {};
      if (input.from) createdAt.$gte = new Date(input.from);
      if (input.to) createdAt.$lte = new Date(input.to);
      match.createdAt = createdAt;
    }

    const [summary] = await this.orderModel.aggregate<SalesSummary>([
      { $match: match },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$total' },
          orderCount: { $sum: 1 },
        },
      },
    ]);
    const topOffers = await this.orderModel.aggregate<TopOfferAggregate>([
      { $match: match },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.description',
          revenue: {
            $sum: { $multiply: ['$items.unitPrice', '$items.quantity'] },
          },
        },
      },
      { $sort: { revenue: -1 } },
      { $limit: 5 },
    ]);

    return {
      totalRevenue: summary?.totalRevenue ?? 0,
      orderCount: summary?.orderCount ?? 0,
      topOffers: topOffers.map((offer) => ({
        description: offer._id,
        revenue: offer.revenue,
      })),
    };
  }
}
