import { zonedTimeToUtc } from '../../booking/availability/availability.service';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import type {
  CreateExpenseInput,
  GenerateInvoiceFromExpensesInput,
  UpdateExpenseInput,
} from '@korva/validation';
import type { Pagination } from '@korva/types';
import { ExpensesRepository, FindExpensesOptions } from './expenses.repository';
import { ExpenseDocument } from './schemas/expense.schema';
import { CountersService } from '../../core/counters/counters.service';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { InvoicesService } from '../invoices/invoices.service';
import { InvoiceDocument } from '../invoices/schemas/invoice.schema';

@Injectable()
export class ExpensesService {
  constructor(
    private readonly expensesRepository: ExpensesRepository,
    private readonly countersService: CountersService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
    private readonly contactsService: ContactsService,
    private readonly invoicesService: InvoicesService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async create(
    organizationId: string,
    userId: string,
    input: CreateExpenseInput,
  ): Promise<ExpenseDocument> {
    if (input.billable && input.contactId) {
      await this.assertContactExists(organizationId, input.contactId);
    }

    const number = await this.countersService.nextFormatted(
      organizationId,
      'expense',
      'DEP',
    );

    const expense = await this.expensesRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      number,
      category: input.category,
      description: input.description,
      amount: input.amount,
      currency: input.currency,
      date: new Date(input.date),
      vendor: input.vendor,
      contactId: input.contactId
        ? new Types.ObjectId(input.contactId)
        : undefined,
      billable: input.billable,
      notes: input.notes,
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'expense',
      entityId: expense.id as string,
    });

    await this.eventBus.publish(organizationId, 'expense.created', {
      expenseId: expense.id as string,
      category: expense.category,
      amount: expense.amount,
      currency: expense.currency,
    });

    return expense;
  }

  async getById(organizationId: string, id: string): Promise<ExpenseDocument> {
    const expense = await this.expensesRepository.findById(organizationId, id);
    if (!expense) {
      throw new NotFoundException({
        code: 'EXPENSE_NOT_FOUND',
        message: 'Expense not found',
      });
    }
    return expense;
  }

  async list(
    organizationId: string,
    query: FindExpensesOptions,
  ): Promise<{ data: ExpenseDocument[]; pagination: Pagination }> {
    const { data, total } = await this.expensesRepository.findAll(
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
    input: UpdateExpenseInput,
  ): Promise<ExpenseDocument> {
    const expense = await this.getById(organizationId, id);
    if (expense.status !== 'recorded') {
      throw new BadRequestException({
        code: 'EXPENSE_NOT_EDITABLE',
        message:
          'Only a recorded (not yet invoiced or voided) expense can be edited',
      });
    }

    const billable = input.billable ?? expense.billable;
    const contactId = input.contactId ?? expense.contactId?.toString();
    if (billable && !contactId) {
      throw new BadRequestException({
        code: 'EXPENSE_BILLABLE_REQUIRES_CONTACT',
        message: 'A billable expense must have a contactId',
      });
    }
    if (input.contactId) {
      await this.assertContactExists(organizationId, input.contactId);
    }

    const updated = await this.expensesRepository.update(organizationId, id, {
      category: input.category,
      description: input.description,
      amount: input.amount,
      currency: input.currency,
      date: input.date ? new Date(input.date) : undefined,
      vendor: input.vendor,
      contactId: input.contactId
        ? new Types.ObjectId(input.contactId)
        : undefined,
      billable: input.billable,
      notes: input.notes,
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'EXPENSE_NOT_FOUND',
        message: 'Expense not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'expense',
      entityId: id,
    });

    return updated;
  }

  async void(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<ExpenseDocument> {
    const expense = await this.getById(organizationId, id);
    if (expense.status !== 'recorded') {
      throw new BadRequestException({
        code: 'EXPENSE_INVALID_TRANSITION',
        message: `Cannot void an expense with status "${expense.status}"`,
      });
    }

    const updated = await this.expensesRepository.update(organizationId, id, {
      status: 'voided',
    });
    if (!updated) {
      throw new NotFoundException({
        code: 'EXPENSE_NOT_FOUND',
        message: 'Expense not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'expense',
      entityId: id,
      metadata: { status: 'voided' },
    });

    return updated;
  }

  async delete(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<void> {
    // Confirmed to exist first so a delete on an unknown/foreign-org id 404s instead of
    // silently reporting `deleted: false` — same "check then delete" order as
    // ContactsService.delete.
    await this.getById(organizationId, id);

    const deleted = await this.expensesRepository.delete(organizationId, id);
    if (!deleted) {
      throw new NotFoundException({
        code: 'EXPENSE_NOT_FOUND',
        message: 'Expense not found',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'DELETE',
      entity: 'expense',
      entityId: id,
    });
  }

  /**
   * Symmetric extension of TimeEntriesService.generateInvoice — same validation shape (all
   * selected records exist, same contact, same currency, eligible status), same atomic
   * all-or-nothing guard against concurrent invoicing (see ExpensesRepository.markInvoiced), and
   * the same "insert Invoice + mark the source records invoiced in one transaction" structure.
   */
  async generateInvoice(
    organizationId: string,
    callerUserId: string,
    input: GenerateInvoiceFromExpensesInput,
  ): Promise<InvoiceDocument> {
    const expenses = await this.expensesRepository.findByIds(
      organizationId,
      input.expenseIds,
    );
    if (expenses.length !== input.expenseIds.length) {
      const foundIds = new Set(expenses.map((e) => e.id as string));
      const missing = input.expenseIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException({
        code: 'EXPENSE_NOT_FOUND',
        message: `Expense not found: ${missing.join(', ')}`,
      });
    }

    if (expenses.some((e) => e.status !== 'recorded')) {
      throw new BadRequestException({
        code: 'EXPENSE_NOT_EDITABLE',
        message:
          'Only recorded (not yet invoiced or voided) expenses can be invoiced',
      });
    }
    if (expenses.some((e) => !e.billable || !e.contactId)) {
      throw new BadRequestException({
        code: 'EXPENSE_NOT_BILLABLE',
        message: 'Non-billable expenses cannot be invoiced',
      });
    }

    const contactId = expenses[0]!.contactId!.toString();
    if (expenses.some((e) => e.contactId!.toString() !== contactId)) {
      throw new BadRequestException({
        code: 'EXPENSES_MIXED_CONTACT',
        message: 'All selected expenses must belong to the same client',
      });
    }

    const currency = expenses[0]!.currency;
    if (expenses.some((e) => e.currency !== currency)) {
      throw new BadRequestException({
        code: 'EXPENSES_MIXED_CURRENCY',
        message: 'All selected expenses must use the same currency',
      });
    }

    const items = expenses.map((expense) => {
      const dateLabel = expense.date.toISOString().slice(0, 10);
      return {
        description: `${dateLabel} — ${expense.description}${expense.vendor ? ` (${expense.vendor})` : ''}`,
        quantity: 1,
        unitPrice: expense.amount,
      };
    });

    const expenseIds = expenses.map((e) => e.id as string);
    const session = await this.connection.startSession();
    let invoice: InvoiceDocument;
    try {
      invoice = await session.withTransaction(async () => {
        // No back-reference field on Invoice for this source (same as TimeEntry) — the link is
        // tracked the other direction, via Expense.invoiceId below.
        const created = await this.invoicesService.createFromTimeEntries(
          organizationId,
          {
            contactId,
            items,
            currency,
            dueDate: input.dueDate,
            notes: input.notes,
          },
          session,
        );

        const { matchedCount } = await this.expensesRepository.markInvoiced(
          organizationId,
          expenseIds,
          created.id as string,
          session,
        );
        if (matchedCount !== expenseIds.length) {
          throw new BadRequestException({
            code: 'EXPENSES_NOT_INVOICEABLE',
            message:
              'One or more expenses were modified concurrently and are no longer invoiceable',
          });
        }

        return created;
      });
    } finally {
      await session.endSession();
    }

    await this.auditService.record({
      organizationId,
      userId: callerUserId,
      action: 'CREATE',
      entity: 'invoice',
      entityId: invoice.id as string,
      metadata: { expenseIds },
    });

    return invoice;
  }

  private async assertContactExists(
    organizationId: string,
    contactId: string,
  ): Promise<void> {
    const exists = await this.contactsService.existsById(
      organizationId,
      contactId,
    );
    if (!exists) {
      throw new NotFoundException({
        code: 'CONTACT_NOT_FOUND',
        message: 'Contact not found',
      });
    }
  }

  /**
   * "Bénéfice du mois": what came in (payments completed in the month, any method, less the
   * refunds made in it) minus the month's expenses (not voided), in the business's currency and
   * calendar month. A cash view — what the owner can actually see in the till and the account —
   * not an accounting result (no depreciation, no stock valuation).
   */
  async profit(organizationId: string, month: string): Promise<MonthlyProfit> {
    const db = this.connection.db!;
    const orgId = new Types.ObjectId(organizationId);
    const organization = await db
      .collection('organizations')
      .findOne({ _id: orgId }, { projection: { currency: 1, timezone: 1 } });
    const currency = (organization?.currency as string | undefined) ?? 'XOF';
    const timeZone = (organization?.timezone as string | undefined) ?? 'UTC';
    const [year, m] = month.split('-').map(Number) as [number, number];
    const next =
      m === 12 ? `${year + 1}-01` : `${year}-${String(m + 1).padStart(2, '0')}`;
    const range = {
      $gte: zonedTimeToUtc(`${month}-01`, '00:00', timeZone),
      $lt: zonedTimeToUtc(`${next}-01`, '00:00', timeZone),
    };
    const sum = async (
      collection: string,
      match: Record<string, unknown>,
      field = '$amount',
    ) => {
      const [row] = await db
        .collection(collection)
        .aggregate<{ total: number }>([
          { $match: { organizationId: orgId, currency, ...match } },
          { $group: { _id: null, total: { $sum: field } } },
        ])
        .toArray();
      return row?.total ?? 0;
    };
    const [collected, byCategory] = await Promise.all([
      sum('payments', {
        status: { $in: ['completed', 'refunded'] },
        createdAt: range,
      }),
      db
        .collection('expenses')
        .aggregate<{ _id: string; total: number }>([
          {
            $match: {
              organizationId: orgId,
              currency,
              status: { $ne: 'voided' },
              date: range,
            },
          },
          { $group: { _id: '$category', total: { $sum: '$amount' } } },
          { $sort: { total: -1 } },
        ])
        .toArray(),
    ]);
    // Refunds have no currency of their own: those of this business's payments, done in the month.
    const [refundRow] = await db
      .collection('refunds')
      .aggregate<{ total: number }>([
        {
          $match: {
            organizationId: orgId,
            status: 'completed',
            updatedAt: range,
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ])
      .toArray();
    const round = (value: number) => Math.round(value * 100) / 100;
    const refunded = round(refundRow?.total ?? 0);
    const expenses = round(
      byCategory.reduce((total, row) => total + row.total, 0),
    );
    const income = round(collected - refunded);
    return {
      month,
      currency,
      collected: round(collected),
      refunded,
      expenses,
      profit: round(income - expenses),
      expensesByCategory: byCategory.map((row) => ({
        category: row._id,
        amount: round(row.total),
      })),
    };
  }
}

export interface MonthlyProfit {
  month: string;
  currency: string;
  collected: number;
  refunded: number;
  expenses: number;
  profit: number;
  expensesByCategory: { category: string; amount: number }[];
}
