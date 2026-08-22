import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Quote, QuoteSchema } from './quotes/schemas/quote.schema';
import { Invoice, InvoiceSchema } from './invoices/schemas/invoice.schema';
import { Payment, PaymentSchema } from './payments/schemas/payment.schema';
import { Refund, RefundSchema } from './payments/schemas/refund.schema';

import { QuotesRepository } from './quotes/quotes.repository';
import { QuotesService } from './quotes/quotes.service';
import { QuotesController } from './quotes/quotes.controller';

import { InvoicesRepository } from './invoices/invoices.repository';
import { InvoicesService } from './invoices/invoices.service';
import { InvoicesController } from './invoices/invoices.controller';

import { PaymentsRepository } from './payments/payments.repository';
import { PaymentsService } from './payments/payments.service';
import { PaymentReconciliationService } from './payments/payment-reconciliation.service';
import { ReconciliationSchedulerService } from './payments/reconciliation-scheduler.service';
import { PaymentsController } from './payments/payments.controller';
import { PAYMENT_PROVIDER } from './payments/providers/payment-provider.interface';
import { ManualPaymentProvider } from './payments/providers/manual-payment.provider';

import { CrmModule } from '../crm/crm.module';
import { CountersModule } from '../core/counters/counters.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Quote.name, schema: QuoteSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
    ]),
    CrmModule,
    CountersModule,
    AuditModule,
  ],
  controllers: [QuotesController, InvoicesController, PaymentsController],
  providers: [
    QuotesRepository,
    QuotesService,
    InvoicesRepository,
    InvoicesService,
    PaymentsRepository,
    PaymentsService,
    PaymentReconciliationService,
    ReconciliationSchedulerService,
    { provide: PAYMENT_PROVIDER, useClass: ManualPaymentProvider },
  ],
  exports: [InvoicesService, QuotesService, PaymentReconciliationService],
})
export class FinanceModule {}
