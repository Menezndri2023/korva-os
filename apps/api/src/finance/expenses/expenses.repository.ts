import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { Expense, ExpenseDocument } from './schemas/expense.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindExpensesOptions {
  page: number;
  limit: number;
  status?: string;
  category?: string;
}

@Injectable()
export class ExpensesRepository {
  constructor(
    @InjectModel(Expense.name)
    private readonly expenseModel: Model<ExpenseDocument>,
  ) {}

  create(data: Partial<Expense>): Promise<ExpenseDocument> {
    return this.expenseModel.create(data);
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<ExpenseDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.expenseModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  /** Batched `$in` lookup — same pattern as TimeEntriesRepository.findByIds, used by
   *  ExpensesService.generateInvoice to fetch every selected expense in one round trip. */
  findByIds(organizationId: string, ids: string[]): Promise<ExpenseDocument[]> {
    const validIds = ids.filter((id) => Types.ObjectId.isValid(id));
    return this.expenseModel
      .find({
        _id: { $in: validIds.map((id) => new Types.ObjectId(id)) },
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindExpensesOptions,
  ): Promise<Paginated<ExpenseDocument>> {
    const filter: FilterQuery<Expense> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.status) filter.status = options.status;
    if (options.category) filter.category = options.category;

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.expenseModel
        .find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.expenseModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Expense>,
  ): Promise<ExpenseDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.expenseModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        data,
        { new: true },
      )
      .exec();
  }

  async delete(organizationId: string, id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const res = await this.expenseModel
      .deleteOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
    return res.deletedCount > 0;
  }

  /** Atomic all-or-nothing guard against concurrent generateInvoice() calls — same shape as
   *  TimeEntriesRepository.markInvoiced. A short matchedCount means one or more expenses were
   *  modified (voided, already invoiced) between the caller's read and this write; the caller
   *  converts that into EXPENSES_NOT_INVOICEABLE rather than silently creating a partial invoice. */
  async markInvoiced(
    organizationId: string,
    ids: string[],
    invoiceId: string,
    session: ClientSession,
  ): Promise<{ matchedCount: number }> {
    const res = await this.expenseModel
      .updateMany(
        {
          _id: { $in: ids.map((id) => new Types.ObjectId(id)) },
          organizationId: new Types.ObjectId(organizationId),
          status: 'recorded',
          invoiceId: { $exists: false },
        },
        { status: 'invoiced', invoiceId: new Types.ObjectId(invoiceId) },
        { session },
      )
      .exec();
    return { matchedCount: res.matchedCount };
  }
}
