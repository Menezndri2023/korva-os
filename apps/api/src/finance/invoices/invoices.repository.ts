import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Invoice, InvoiceDocument } from './schemas/invoice.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindInvoicesOptions {
  page: number;
  limit: number;
  status?: string;
  contactId?: string;
}

@Injectable()
export class InvoicesRepository {
  constructor(
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
  ) {}

  create(data: Partial<Invoice>): Promise<InvoiceDocument> {
    return this.invoiceModel.create(data);
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<InvoiceDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.invoiceModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindInvoicesOptions,
  ): Promise<Paginated<InvoiceDocument>> {
    const filter: FilterQuery<Invoice> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.status) filter.status = options.status;
    if (options.contactId)
      filter.contactId = new Types.ObjectId(options.contactId);

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.invoiceModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.invoiceModel.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Invoice>,
  ): Promise<InvoiceDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.invoiceModel
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
}
