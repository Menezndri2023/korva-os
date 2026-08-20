import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { CreateQuoteInput, UpdateQuoteInput } from '@korva/validation';
import type { Pagination } from '@korva/types';
import { QuotesRepository, FindQuotesOptions } from './quotes.repository';
import { QuoteDocument } from './schemas/quote.schema';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { CountersService } from '../../core/counters/counters.service';
import { AuditService } from '../../audit/audit.service';
import { computeTotals, toLineItemDocs } from '../shared/line-item.schema';
import { InvoicesService } from '../invoices/invoices.service';
import { InvoiceDocument } from '../invoices/schemas/invoice.schema';

@Injectable()
export class QuotesService {
  constructor(
    private readonly quotesRepository: QuotesRepository,
    private readonly contactsService: ContactsService,
    private readonly countersService: CountersService,
    private readonly auditService: AuditService,
    private readonly invoicesService: InvoicesService,
  ) {}

  async create(
    organizationId: string,
    userId: string,
    input: CreateQuoteInput,
  ): Promise<QuoteDocument> {
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

    const totals = computeTotals(input.items);
    const number = await this.countersService.nextFormatted(
      organizationId,
      'quote',
      'DEV',
    );

    const quote = await this.quotesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      contactId: new Types.ObjectId(input.contactId),
      number,
      items: toLineItemDocs(input.items),
      currency: input.currency,
      ...totals,
      validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
      notes: input.notes,
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'quote',
      entityId: quote.id as string,
    });

    return quote;
  }

  async getById(organizationId: string, id: string): Promise<QuoteDocument> {
    const quote = await this.quotesRepository.findById(organizationId, id);
    if (!quote) {
      throw new NotFoundException({
        code: 'QUOTE_NOT_FOUND',
        message: 'Quote not found',
      });
    }
    return quote;
  }

  async list(
    organizationId: string,
    query: FindQuotesOptions,
  ): Promise<{ data: QuoteDocument[]; pagination: Pagination }> {
    const { data, total } = await this.quotesRepository.findAll(
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
    input: UpdateQuoteInput,
  ): Promise<QuoteDocument> {
    const quote = await this.getById(organizationId, id);
    if (quote.status !== 'draft') {
      throw new BadRequestException({
        code: 'QUOTE_NOT_EDITABLE',
        message: 'Only draft quotes can be edited',
      });
    }

    const totals = input.items ? computeTotals(input.items) : undefined;
    const updated = await this.quotesRepository.update(organizationId, id, {
      items: input.items ? toLineItemDocs(input.items) : undefined,
      ...totals,
      validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
      notes: input.notes,
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'QUOTE_NOT_FOUND',
        message: 'Quote not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'quote',
      entityId: id,
    });

    return updated;
  }

  async send(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<QuoteDocument> {
    return this.transition(organizationId, userId, id, ['draft'], 'sent');
  }

  async accept(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<QuoteDocument> {
    return this.transition(
      organizationId,
      userId,
      id,
      ['sent', 'viewed'],
      'accepted',
    );
  }

  async reject(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<QuoteDocument> {
    return this.transition(
      organizationId,
      userId,
      id,
      ['sent', 'viewed'],
      'rejected',
    );
  }

  async convertToInvoice(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<InvoiceDocument> {
    const quote = await this.getById(organizationId, id);
    if (quote.status !== 'accepted') {
      throw new BadRequestException({
        code: 'QUOTE_NOT_ACCEPTED',
        message: 'Only an accepted quote can be converted to an invoice',
      });
    }

    return this.invoicesService.createFromQuote(organizationId, userId, {
      contactId: quote.contactId.toString(),
      quoteId: quote.id as string,
      currency: quote.currency,
      items: quote.items.map((item) => ({
        offerId: item.offerId?.toString(),
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate,
      })),
    });
  }

  private async transition(
    organizationId: string,
    userId: string,
    id: string,
    allowedFrom: QuoteDocument['status'][],
    to: QuoteDocument['status'],
  ): Promise<QuoteDocument> {
    const quote = await this.getById(organizationId, id);
    if (!allowedFrom.includes(quote.status)) {
      throw new BadRequestException({
        code: 'QUOTE_INVALID_TRANSITION',
        message: `Cannot move quote from "${quote.status}" to "${to}"`,
      });
    }

    const updated = await this.quotesRepository.update(organizationId, id, {
      status: to,
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'QUOTE_NOT_FOUND',
        message: 'Quote not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'quote',
      entityId: id,
      metadata: { status: to },
    });

    return updated;
  }
}
