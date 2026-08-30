import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Quote, QuoteSchema } from './quotes/schemas/quote.schema';
import { Invoice, InvoiceSchema } from './invoices/schemas/invoice.schema';
import { Payment, PaymentSchema } from './payments/schemas/payment.schema';
import { Refund, RefundSchema } from './payments/schemas/refund.schema';
import { Expense, ExpenseSchema } from './expenses/schemas/expense.schema';
import {
  TimeEntry,
  TimeEntrySchema,
} from './time-entries/schemas/time-entry.schema';

import { QuotesRepository } from './quotes/quotes.repository';
import { QuotesService } from './quotes/quotes.service';
import { QuotesController } from './quotes/quotes.controller';
import { QuoteExpirySchedulerService } from './quotes/quote-expiry-scheduler.service';

import { InvoicesRepository } from './invoices/invoices.repository';
import { InvoicesService } from './invoices/invoices.service';
import { InvoicesController } from './invoices/invoices.controller';
import { InvoiceOverdueSchedulerService } from './invoices/invoice-overdue-scheduler.service';

import { PaymentsRepository } from './payments/payments.repository';
import { PaymentsService } from './payments/payments.service';
import { PaymentReconciliationService } from './payments/payment-reconciliation.service';
import { ReconciliationSchedulerService } from './payments/reconciliation-scheduler.service';
import { PaymentsController } from './payments/payments.controller';
import { PAYMENT_PROVIDER } from './payments/providers/payment-provider.interface';
import { ManualPaymentProvider } from './payments/providers/manual-payment.provider';
import { FlutterwaveWebhookController } from './payments/providers/flutterwave-webhook.controller';
import { PaystackWebhookController } from './payments/providers/paystack-webhook.controller';

import { ExpensesRepository } from './expenses/expenses.repository';
import { ExpensesService } from './expenses/expenses.service';
import { ExpensesController } from './expenses/expenses.controller';

import { TimeEntriesRepository } from './time-entries/time-entries.repository';
import { TimeEntriesService } from './time-entries/time-entries.service';
import { TimeEntriesController } from './time-entries/time-entries.controller';

import { CrmModule } from '../crm/crm.module';
import { CountersModule } from '../core/counters/counters.module';
import { AuditModule } from '../audit/audit.module';
import { IntegrationWebhookModule } from '../integrations/webhooks/integration-webhook.module';
// For MembershipsService (TimeEntriesService's staff-default-rate lookup). Safe: IdentityModule
// imports neither FinanceModule nor anything that transitively does (verified by grepping every
// `import { IdentityModule }` site — only Organizations/Subscriptions/Communication/AppModule —
// before adding this edge, per this codebase's own "check the reverse edge first" convention).
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Quote.name, schema: QuoteSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: Expense.name, schema: ExpenseSchema },
      { name: TimeEntry.name, schema: TimeEntrySchema },
    ]),
    CrmModule,
    CountersModule,
    AuditModule,
    IntegrationWebhookModule,
    IdentityModule,
  ],
  controllers: [
    QuotesController,
    InvoicesController,
    PaymentsController,
    ExpensesController,
    TimeEntriesController,
    FlutterwaveWebhookController,
    PaystackWebhookController,
  ],
  providers: [
    QuotesRepository,
    QuotesService,
    QuoteExpirySchedulerService,
    InvoicesRepository,
    InvoicesService,
    InvoiceOverdueSchedulerService,
    PaymentsRepository,
    PaymentsService,
    PaymentReconciliationService,
    ReconciliationSchedulerService,
    // Real payment creation still goes exclusively through ManualPaymentProvider — unchanged
    // from Stage 1. PaymentProviderResolverService/Registry (Wave 4 Stage 2) live in
    // IntegrationsModule instead of here, despite being "payment-domain" conceptually — they
    // depend on INTEGRATION_ACCOUNTS_READER, which only IntegrationsModule provides, and
    // IntegrationsController (which needs the resolver) lives there too. Importing
    // IntegrationsModule from here to get them back would create FinanceModule ↔
    // IntegrationsModule circular imports (confirmed at boot: `Nest can't resolve dependencies
    // of the PaymentProviderResolverService ... INTEGRATION_ACCOUNTS_READER ... available in the
    // FinanceModule module` when they were tried here first).
    { provide: PAYMENT_PROVIDER, useClass: ManualPaymentProvider },
    ExpensesRepository,
    ExpensesService,
    TimeEntriesRepository,
    TimeEntriesService,
  ],
  exports: [InvoicesService, QuotesService, PaymentReconciliationService],
})
export class FinanceModule {}
