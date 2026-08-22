import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClientSession, Types } from 'mongoose';
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

    const invoice = await this.createInvoiceRecord(organizationId, {
      contactId: input.contactId,
      quoteId: input.quoteId,
      items: input.items,
      currency: input.currency,
      dueDate: input.dueDate,
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
    const invoice = await this.createInvoiceRecord(organizationId, input);

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'invoice',
      entityId: invoice.id as string,
    });

    return invoice;
  }

  /**
   * Used by OrdersService when generating an invoice for a confirmed order. `session`, when
   * given, ties the Invoice write to the caller's MongoDB transaction (see
   * OrdersService.generateInvoice) so it commits/aborts together with the Order.invoiceId
   * update. Deliberately does NOT record an audit entry itself, unlike create()/
   * createFromQuote() above — OrdersService.generateInvoice does that after its transaction
   * commits (same "commit, then audit" pattern as PaymentsService.create/refund), so a
   * transaction that aborts (a concurrent loser, or ORDER_ALREADY_INVOICED on retry) never
   * leaves behind an audit entry for an Invoice that was rolled back.
   */
  async createFromOrder(
    organizationId: string,
    input: {
      contactId: string;
      orderId: string;
      items: LineItemInput[];
      currency: string;
    },
    session?: ClientSession,
  ): Promise<InvoiceDocument> {
    return this.createInvoiceRecord(organizationId, input, session);
  }

  private async createInvoiceRecord(
    organizationId: string,
    input: {
      contactId: string;
      quoteId?: string;
      orderId?: string;
      items: LineItemInput[];
      currency: string;
      dueDate?: string;
      notes?: string;
    },
    session?: ClientSession,
  ): Promise<InvoiceDocument> {
    const totals = computeTotals(input.items);
    const number = await this.countersService.nextFormatted(
      organizationId,
      'invoice',
      'FAC',
    );

    return this.invoicesRepository.create(
      {
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
      },
      session,
    );
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

  /**
   * Called by PaymentsService after a completed payment/refund to keep amountPaid and status
   * in sync. Applies `delta` (positive for a payment, negative for a refund) atomically in
   * MongoDB — see InvoicesRepository.incrementAmountPaid — so two concurrent calls for the
   * same invoice can never overwrite each other's result.
   */
  async applyPaymentDelta(
    organizationId: string,
    id: string,
    delta: number,
    session?: ClientSession,
  ): Promise<InvoiceDocument> {
    const updated = await this.invoicesRepository.incrementAmountPaid(
      organizationId,
      id,
      delta,
      session,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'INVOICE_NOT_FOUND',
        message: 'Invoice not found',
      });
    }
    return updated;
  }

  /**
   * Payment-specific: applies a positive amount to amountPaid only if doing so would not
   * exceed `total` — the balance check and the write happen in the same MongoDB operation
   * (see InvoicesRepository.incrementAmountPaidWithinLimit), so two concurrent payments can
   * never both succeed past the invoice's total. Returns null when the guard rejects the
   * update; unlike every other method here, this never throws NotFoundException itself —
   * PaymentsService already confirms the invoice exists moments earlier, so a null result at
   * this point means the balance guard rejected it, which is for the caller to interpret
   * (as PAYMENT_EXCEEDS_BALANCE) rather than for this method to assume.
   */
  applyPaymentIfWithinBalance(
    organizationId: string,
    id: string,
    amount: number,
    session?: ClientSession,
  ): Promise<InvoiceDocument | null> {
    return this.invoicesRepository.incrementAmountPaidWithinLimit(
      organizationId,
      id,
      amount,
      session,
    );
  }
}
