import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { Ticket, TicketDocument } from './schemas/ticket.schema';
import type { Paginated } from '../../crm/contacts/contacts.repository';

export interface FindTicketsOptions {
  page: number;
  limit: number;
  status?: string;
  priority?: string;
  assigneeMembershipId?: string;
  contactId?: string;
}

@Injectable()
export class TicketsRepository {
  constructor(
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,
  ) {}

  create(data: Partial<Ticket>): Promise<TicketDocument> {
    return this.ticketModel.create(data);
  }

  findById(organizationId: string, id: string): Promise<TicketDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.ticketModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  async findAll(
    organizationId: string,
    options: FindTicketsOptions,
  ): Promise<Paginated<TicketDocument>> {
    const filter: FilterQuery<Ticket> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (options.status) filter.status = options.status;
    if (options.priority) filter.priority = options.priority;
    if (options.assigneeMembershipId) {
      filter.assigneeMembershipId = new Types.ObjectId(
        options.assigneeMembershipId,
      );
    }
    if (options.contactId)
      filter.contactId = new Types.ObjectId(options.contactId);

    const skip = (options.page - 1) * options.limit;
    const [data, total] = await Promise.all([
      this.ticketModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(options.limit)
        .exec(),
      this.ticketModel.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }

  update(
    organizationId: string,
    id: string,
    data: Partial<Ticket>,
  ): Promise<TicketDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.ticketModel
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

  /**
   * Dedicated `$unset` for reopening — the generic `update()` above relies on Mongoose's
   * implicit `$set` wrapping, which silently DROPS `undefined`-valued keys rather than clearing
   * them in MongoDB (a real, previously-hit gotcha in this codebase). `resolvedAt`/`closedAt`
   * would otherwise keep their stale values after a reopen.
   */
  reopen(organizationId: string, id: string): Promise<TicketDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.ticketModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        { $set: { status: 'open' }, $unset: { resolvedAt: '', closedAt: '' } },
        { new: true },
      )
      .exec();
  }
}
