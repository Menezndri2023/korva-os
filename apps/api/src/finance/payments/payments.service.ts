import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { CreatePaymentInput, CreateRefundInput } from '@korva/validation';
import { PaymentsRepository } from './payments.repository';
import { PaymentDocument } from './schemas/payment.schema';
import { RefundDocument } from './schemas/refund.schema';
import { InvoicesService } from '../invoices/invoices.service';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './providers/payment-provider.interface';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly paymentsRepository: PaymentsRepository,
    private readonly invoicesService: InvoicesService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
    @Inject(PAYMENT_PROVIDER) private readonly paymentProvider: PaymentProvider,
  ) {}

  async create(
    organizationId: string,
    userId: string,
    input: CreatePaymentInput,
  ): Promise<PaymentDocument> {
    const invoice = await this.invoicesService.getById(
      organizationId,
      input.invoiceId,
    );
    if (invoice.status === 'draft' || invoice.status === 'cancelled') {
      throw new BadRequestException({
        code: 'INVOICE_NOT_PAYABLE',
        message: `Cannot record a payment against an invoice with status "${invoice.status}"`,
      });
    }

    const remaining =
      Math.round((invoice.total - invoice.amountPaid) * 100) / 100;
    if (input.amount > remaining) {
      throw new BadRequestException({
        code: 'PAYMENT_EXCEEDS_BALANCE',
        message: `Payment amount (${input.amount}) exceeds the remaining balance (${remaining})`,
      });
    }

    const result = await this.paymentProvider.createPayment({
      amount: input.amount,
      currency: invoice.currency,
      invoiceId: input.invoiceId,
    });

    const payment = await this.paymentsRepository.createPayment({
      organizationId: new Types.ObjectId(organizationId),
      invoiceId: new Types.ObjectId(input.invoiceId),
      amount: input.amount,
      currency: invoice.currency,
      status: result.status,
      provider: this.paymentProvider.name,
      providerReference: result.providerReference,
      method: input.method,
    });

    if (result.status === 'completed') {
      await this.invoicesService.applyPaymentDelta(
        organizationId,
        input.invoiceId,
        input.amount,
      );
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'PAYMENT',
      entity: 'payment',
      entityId: payment.id as string,
      metadata: {
        invoiceId: input.invoiceId,
        amount: input.amount,
        status: result.status,
      },
    });

    if (result.status === 'completed') {
      await this.eventBus.publish(organizationId, 'payment.completed', {
        paymentId: payment.id as string,
        invoiceId: input.invoiceId,
        amount: input.amount,
      });
    }

    return payment;
  }

  list(organizationId: string, invoiceId?: string): Promise<PaymentDocument[]> {
    return this.paymentsRepository.findAll(organizationId, invoiceId);
  }

  async refund(
    organizationId: string,
    userId: string,
    input: CreateRefundInput,
  ): Promise<RefundDocument> {
    const payment = await this.paymentsRepository.findById(
      organizationId,
      input.paymentId,
    );
    if (!payment) {
      throw new NotFoundException({
        code: 'PAYMENT_NOT_FOUND',
        message: 'Payment not found',
      });
    }
    if (payment.status !== 'completed') {
      throw new BadRequestException({
        code: 'PAYMENT_NOT_REFUNDABLE',
        message: `Cannot refund a payment with status "${payment.status}"`,
      });
    }

    const alreadyRefunded = await this.paymentsRepository.sumRefundsForPayment(
      organizationId,
      input.paymentId,
    );
    const refundable =
      Math.round((payment.amount - alreadyRefunded) * 100) / 100;
    if (input.amount > refundable) {
      throw new BadRequestException({
        code: 'REFUND_EXCEEDS_PAYMENT',
        message: `Refund amount (${input.amount}) exceeds the refundable balance (${refundable})`,
      });
    }

    await this.paymentProvider.refundPayment(
      payment.providerReference ?? (payment.id as string),
      input.amount,
    );

    const refund = await this.paymentsRepository.createRefund({
      organizationId: new Types.ObjectId(organizationId),
      paymentId: new Types.ObjectId(input.paymentId),
      amount: input.amount,
      reason: input.reason,
    });

    if (input.amount >= refundable) {
      await this.paymentsRepository.updatePaymentStatus(
        organizationId,
        input.paymentId,
        'refunded',
      );
    }

    await this.invoicesService.applyPaymentDelta(
      organizationId,
      payment.invoiceId.toString(),
      -input.amount,
    );

    await this.auditService.record({
      organizationId,
      userId,
      action: 'REFUND',
      entity: 'payment',
      entityId: input.paymentId,
      metadata: { amount: input.amount, reason: input.reason },
    });

    return refund;
  }
}
