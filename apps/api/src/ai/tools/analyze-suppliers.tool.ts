import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { PurchaseOrdersService } from '../../catalog/purchase-orders/purchase-orders.service';

const inputSchema = z.object({});

/** Phase C4 — per-supplier spend and on-time delivery rate, off the existing PurchaseOrder
 *  ledger (see PurchaseOrdersService.getSupplierAnalysis's own doc for exactly what counts). */
@Injectable()
export class AnalyzeSuppliersTool implements AiTool<
  z.infer<typeof inputSchema>
> {
  readonly definition = {
    name: 'analyze_suppliers',
    description:
      'Analyse les fournisseurs : nombre de commandes, dépense totale et taux de livraison à temps.',
    inputSchema: { type: 'object', properties: {} },
  };
  readonly requiredPermission = 'purchase_orders.read' as const;
  readonly auditEntity = 'supplier';

  constructor(private readonly purchaseOrdersService: PurchaseOrdersService) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  execute(organizationId: string) {
    return this.purchaseOrdersService.getSupplierAnalysis(organizationId);
  }
}
