import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { CreateExpenseInput, UpdateExpenseInput } from '@korva/validation';
import type { Pagination } from '@korva/types';
import { ExpensesRepository, FindExpensesOptions } from './expenses.repository';
import { ExpenseDocument } from './schemas/expense.schema';
import { CountersService } from '../../core/counters/counters.service';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';

@Injectable()
export class ExpensesService {
  constructor(
    private readonly expensesRepository: ExpensesRepository,
    private readonly countersService: CountersService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
  ) {}

  async create(
    organizationId: string,
    userId: string,
    input: CreateExpenseInput,
  ): Promise<ExpenseDocument> {
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
        message: 'Only a recorded (non-voided) expense can be edited',
      });
    }

    const updated = await this.expensesRepository.update(organizationId, id, {
      category: input.category,
      description: input.description,
      amount: input.amount,
      currency: input.currency,
      date: input.date ? new Date(input.date) : undefined,
      vendor: input.vendor,
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
}
