import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { Refund, RefundDocument } from './schemas/refund.schema';

@Injectable()
export class PaymentsRepository {
  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(Refund.name)
    private readonly refundModel: Model<RefundDocument>,
  ) {}

  createPayment(data: Partial<Payment>): Promise<PaymentDocument> {
    return this.paymentModel.create(data);
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<PaymentDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.paymentModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  findAll(
    organizationId: string,
    invoiceId?: string,
  ): Promise<PaymentDocument[]> {
    const filter: Record<string, unknown> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (invoiceId) filter.invoiceId = new Types.ObjectId(invoiceId);
    return this.paymentModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  async updatePaymentStatus(
    organizationId: string,
    id: string,
    status: Payment['status'],
  ): Promise<PaymentDocument | null> {
    return this.paymentModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        { status },
        { new: true },
      )
      .exec();
  }

  createRefund(data: Partial<Refund>): Promise<RefundDocument> {
    return this.refundModel.create(data);
  }

  sumRefundsForPayment(
    organizationId: string,
    paymentId: string,
  ): Promise<number> {
    return this.refundModel
      .aggregate<{ total: number }>([
        {
          $match: {
            organizationId: new Types.ObjectId(organizationId),
            paymentId: new Types.ObjectId(paymentId),
          },
        },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ])
      .exec()
      .then((rows) => rows[0]?.total ?? 0);
  }
}
