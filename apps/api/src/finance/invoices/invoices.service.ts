import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type {
  CreateInvoiceInput,
  LineItemInput,
  UpdateInvoiceInput,
} from '@korva/validation';
import type { Pagination } from '@korva/types';
import { InvoicesRepository, FindInvoicesOptions } from './invoices.repository';
import { InvoiceDocument } from './schemas/invoice.schema';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { CountersService } from '../../core/counters/counters.service';
import { AuditService } from '../../audit/audit.service';
import { computeTotals, toLineItemDocs } from '../../shared/line-item.schema';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly invoicesRepository: InvoicesRepository,
    private readonly contactsService: ContactsService,
    private readonly countersService: CountersService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    organizationId: string,
    userId: string,
    input: CreateInvoiceInput,
  ): Promise<InvoiceDocument> {
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

    return this.createInvoiceRecord(organizationId, userId, {
      contactId: input.contactId,
      quoteId: input.quoteId,
      items: input.items,
      currency: input.currency,
      dueDate: input.dueDate,
      notes: input.notes,
    });
  }

  /** Used by QuotesService when converting an accepted quote — the contact and items are already known-good. */
  async createFromQuote(
    organizationId: string,
    userId: string,
    input: {
      contactId: string;
      quoteId: string;
      items: LineItemInput[];
      currency: string;
    },
  ): Promise<InvoiceDocument> {
    return this.createInvoiceRecord(organizationId, userId, input);
  }

  /** Used by OrdersService when generating an invoice for a confirmed order. */
  async createFromOrder(
    organizationId: string,
    userId: string,
    input: {
      contactId: string;
      orderId: string;
      items: LineItemInput[];
      currency: string;
    },
  ): Promise<InvoiceDocument> {
    return this.createInvoiceRecord(organizationId, userId, input);
  }

  private async createInvoiceRecord(
    organizationId: string,
    userId: string,
    input: {
      contactId: string;
      quoteId?: string;
      orderId?: string;
      items: LineItemInput[];
      currency: string;
      dueDate?: string;
      notes?: string;
    },
  ): Promise<InvoiceDocument> {
    const totals = computeTotals(input.items);
    const number = await this.countersService.nextFormatted(
      organizationId,
      'invoice',
      'FAC',
    );

    const invoice = await this.invoicesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      contactId: new Types.ObjectId(input.contactId),
      quoteId: input.quoteId ? new Types.ObjectId(input.quoteId) : undefined,
      orderId: input.orderId ? new Types.ObjectId(input.orderId) : undefined,
      number,
      items: toLineItemDocs(input.items),
      currency: input.currency,
      ...totals,
      amountPaid: 0,
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      notes: input.notes,
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'invoice',
      entityId: invoice.id as string,
    });

    return invoice;
  }

  async getById(organizationId: string, id: string): Promise<InvoiceDocument> {
    const invoice = await this.invoicesRepository.findById(organizationId, id);
    if (!invoice) {
      throw new NotFoundException({
        code: 'INVOICE_NOT_FOUND',
        message: 'Invoice not found',
      });
    }
    return invoice;
  }

  async list(
    organizationId: string,
    query: FindInvoicesOptions,
  ): Promise<{ data: InvoiceDocument[]; pagination: Pagination }> {
    const { data, total } = await this.invoicesRepository.findAll(
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

  async update(
    organizationId: string,
    userId: string,
    id: string,
    input: UpdateInvoiceInput,
  ): Promise<InvoiceDocument> {
    const invoice = await this.getById(organizationId, id);
    if (invoice.status !== 'draft') {
      throw new BadRequestException({
        code: 'INVOICE_NOT_EDITABLE',
        message: 'Only draft invoices can be edited',
      });
    }

    const totals = input.items ? computeTotals(input.items) : undefined;
    const updated = await this.invoicesRepository.update(organizationId, id, {
      items: input.items ? toLineItemDocs(input.items) : undefined,
      ...totals,
      dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
      notes: input.notes,
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'INVOICE_NOT_FOUND',
        message: 'Invoice not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'invoice',
      entityId: id,
    });

    return updated;
  }

  async issue(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<InvoiceDocument> {
    const invoice = await this.getById(organizationId, id);
    if (invoice.status !== 'draft') {
      throw new BadRequestException({
        code: 'INVOICE_INVALID_TRANSITION',
        message: 'Only draft invoices can be issued',
      });
    }

    const updated = await this.invoicesRepository.update(organizationId, id, {
      status: 'issued',
      issuedAt: new Date(),
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'INVOICE_NOT_FOUND',
        message: 'Invoice not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'invoice',
      entityId: id,
      metadata: { status: 'issued' },
    });

    return updated;
  }

  async cancel(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<InvoiceDocument> {
    const invoice = await this.getById(organizationId, id);
    if (invoice.status === 'paid' || invoice.status === 'cancelled') {
      throw new BadRequestException({
        code: 'INVOICE_INVALID_TRANSITION',
        message: `Cannot cancel an invoice with status "${invoice.status}"`,
      });
    }

    const updated = await this.invoicesRepository.update(organizationId, id, {
      status: 'cancelled',
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'INVOICE_NOT_FOUND',
        message: 'Invoice not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'invoice',
      entityId: id,
      metadata: { status: 'cancelled' },
    });

    return updated;
  }

  /** Called by PaymentsService after a completed payment/refund to keep amountPaid and status in sync. */
  async applyPaymentDelta(
    organizationId: string,
    id: string,
    delta: number,
  ): Promise<InvoiceDocument> {
    const invoice = await this.getById(organizationId, id);
    const amountPaid = Math.max(
      0,
      Math.round((invoice.amountPaid + delta) * 100) / 100,
    );
    const status =
      amountPaid <= 0
        ? 'issued'
        : amountPaid >= invoice.total
          ? 'paid'
          : 'partially_paid';

    const updated = await this.invoicesRepository.update(organizationId, id, {
      amountPaid,
      status,
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'INVOICE_NOT_FOUND',
        message: 'Invoice not found',
      });
    }
    return updated;
  }
}
