import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Counter, CounterDocument } from './schemas/counter.schema';

/** The counter owner for VIT GLOBAL's own invoice sequence: not an organization. */
export const KORVA_INVOICE_COUNTER_OWNER = '000000000000000000000000';

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

  /**
   * The number of KORVA's own next invoice to a business, issued by VIT GLOBAL TECHNOLOGIES
   * GROUP. ONE sequence for the issuer, continuous and chronological, as Moroccan invoicing rules
   * require — until 2026-11-27 each business had its own ABO-0001, so two businesses could hold
   * VIT GLOBAL invoices with the same number. Held by a fixed platform id, never a tenant's.
   */
  nextKorvaInvoiceNumber(): Promise<string> {
    return this.nextFormatted(
      KORVA_INVOICE_COUNTER_OWNER,
      'korva-invoice',
      'VG',
      6,
    );
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
