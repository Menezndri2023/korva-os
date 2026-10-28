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
import type { ResolvedDiscount } from '../../shared/line-item.schema';
import { DiscountCodesService } from '../discount-codes/discount-codes.service';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly invoicesRepository: InvoicesRepository,
    private readonly contactsService: ContactsService,
    private readonly countersService: CountersService,
    private readonly auditService: AuditService,
    private readonly discountCodesService: DiscountCodesService,
  ) {}

  async create(
    organizationId: string,
    // Optional so a system/scheduler-triggered invoice (no staff actor — see
    // RecurringBillingSchedulerService) can call this too, same precedent as
    // ContactsService.update's own `userId: string | undefined` widening; AuditService.record
    // already tolerates undefined.
    userId: string | undefined,
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

    // Not transactional — same "draft/standalone creation, not a derived/system flow" reasoning
    // as QuotesService.create(). createFromQuote/createFromOrder/createFromTimeEntries (system
    // flows deriving from an already-resolved source) deliberately do NOT accept a discount code.
    const reservation = input.discountCode
      ? await this.discountCodesService.validateAndReserve(
          organizationId,
          input.discountCode,
          {
            offerIds: input.items
              .map((item) => item.offerId)
              .filter((id): id is string => !!id),
          },
        )
      : undefined;

    const invoice = await this.createInvoiceRecord(organizationId, {
      contactId: input.contactId,
      quoteId: input.quoteId,
      items: input.items,
      currency: input.currency,
      dueDate: input.dueDate,
      notes: input.notes,
      discount: reservation?.resolved,
      discountCodeId: reservation?.discountCodeId,
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

  /**
   * Used by TimeEntriesService.generateInvoice (billing a batch of approved time entries) AND
   * ExpensesService.generateInvoice (billing a batch of billable expenses) — both bill an
   * existing record batch with no richer Invoice-side back-reference needed (unlike
   * quoteId/orderId, the link is tracked the other direction, via TimeEntry.invoiceId /
   * Expense.invoiceId). Same "no audit here, caller records it after the transaction commits"
   * contract as createFromOrder — see that method's doc comment for the full rationale.
   */
  async createFromTimeEntries(
    organizationId: string,
    input: {
      contactId: string;
      items: LineItemInput[];
      currency: string;
      dueDate?: string;
      notes?: string;
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
      discount?: ResolvedDiscount;
      discountCodeId?: string;
    },
    session?: ClientSession,
  ): Promise<InvoiceDocument> {
    const totals = computeTotals(input.items, input.discount);
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
        discountCodeId: input.discountCodeId
          ? new Types.ObjectId(input.discountCodeId)
          : undefined,
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

  /** Batched equivalent of getById(), one per id — used by
   *  TimeEntriesService.getCommissionReport to check the paid status of every distinct invoice
   *  a batch of time entries was billed through. Missing ids are silently absent from the
   *  returned map rather than throwing — unlike getManyByIds on Offers, a caller here is
   *  reconciling historical records, not validating a fresh request. */
  async getManyByIds(
    organizationId: string,
    ids: string[],
  ): Promise<Map<string, InvoiceDocument>> {
    const invoices = await this.invoicesRepository.findByIds(
      organizationId,
      ids,
    );
    return new Map(invoices.map((invoice) => [invoice.id as string, invoice]));
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
    /** Undefined when the system issues it (a customer paying online from the storefront). */
    userId: string | undefined,
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
