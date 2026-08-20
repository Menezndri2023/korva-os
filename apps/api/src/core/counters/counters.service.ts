import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Counter, CounterDocument } from './schemas/counter.schema';

@Injectable()
export class CountersService {
  constructor(
    @InjectModel(Counter.name)
    private readonly counterModel: Model<CounterDocument>,
  ) {}

  /** Atomically returns the next sequence number for (organizationId, key), starting at 1. */
  async next(organizationId: string, key: string): Promise<number> {
    const counter = await this.counterModel
      .findOneAndUpdate(
        { organizationId: new Types.ObjectId(organizationId), key },
        { $inc: { seq: 1 } },
        { new: true, upsert: true },
      )
      .exec();
    return counter.seq;
  }

  async nextFormatted(
    organizationId: string,
    key: string,
    prefix: string,
    padding = 4,
  ): Promise<string> {
    const seq = await this.next(organizationId, key);
    return `${prefix}-${String(seq).padStart(padding, '0')}`;
  }
}
