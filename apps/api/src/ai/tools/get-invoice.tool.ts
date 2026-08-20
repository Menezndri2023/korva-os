import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import type { AiTool } from './tool.interface';
import { InvoicesService } from '../../finance/invoices/invoices.service';

const inputSchema = z.object({ invoiceId: z.string().min(1) });

@Injectable()
export class GetInvoiceTool implements AiTool<z.infer<typeof inputSchema>> {
  readonly definition = {
    name: 'get_invoice',
    description:
      "Récupère les détails d'une facture par son id (statut, montant payé, solde).",
    inputSchema: {
      type: 'object',
      properties: { invoiceId: { type: 'string' } },
      required: ['invoiceId'],
    },
  };
  readonly requiredPermission = 'invoices.read' as const;
  readonly auditEntity = 'invoice';

  constructor(private readonly invoicesService: InvoicesService) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw);
  }

  async execute(
    organizationId: string,
    _userId: string,
    input: z.infer<typeof inputSchema>,
  ) {
    const invoice = await this.invoicesService.getById(
      organizationId,
      input.invoiceId,
    );
    return {
      id: invoice.id as string,
      number: invoice.number,
      status: invoice.status,
      total: invoice.total,
      amountPaid: invoice.amountPaid,
      currency: invoice.currency,
    };
  }
}
