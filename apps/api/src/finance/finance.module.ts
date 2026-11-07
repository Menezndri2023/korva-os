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
import {
  DiscountCode,
  DiscountCodeSchema,
} from './discount-codes/schemas/discount-code.schema';
import {
  RecurringBilling,
  RecurringBillingSchema,
} from './recurring-billing/schemas/recurring-billing.schema';
// Direct model injection (not `import { CatalogModule }`) — CatalogModule already imports
// FinanceModule (for OfferReferencesRepository), so importing it back here would be a circular
// module dependency. Same established workaround as CrmModule/PublicModule's own direct
// Order/Booking/Contact registrations for the identical class of problem — see recurring-
// billing.service.ts/recurring-billing-scheduler.service.ts for the two read-only consumers.
import { Offer, OfferSchema } from '../catalog/offers/schemas/offer.schema';
import { Contact, ContactSchema } from '../crm/contacts/schemas/contact.schema';

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
import { IntegrationsModule } from '../integrations/integrations.module';
import { FlutterwaveWebhookController } from './payments/providers/flutterwave-webhook.controller';
import { PaystackWebhookController } from './payments/providers/paystack-webhook.controller';
import { GeniusPayWebhookController } from './payments/providers/geniuspay-webhook.controller';

import { ExpensesRepository } from './expenses/expenses.repository';
import { ExpensesService } from './expenses/expenses.service';
import { ExpensesController } from './expenses/expenses.controller';

import { TimeEntriesRepository } from './time-entries/time-entries.repository';
import { TimeEntriesService } from './time-entries/time-entries.service';
import { TimeEntriesController } from './time-entries/time-entries.controller';

import { DiscountCodesRepository } from './discount-codes/discount-codes.repository';
import { DiscountCodesService } from './discount-codes/discount-codes.service';
import { DiscountCodesController } from './discount-codes/discount-codes.controller';

import { RecurringBillingRepository } from './recurring-billing/recurring-billing.repository';
import { RecurringBillingService } from './recurring-billing/recurring-billing.service';
import { RecurringBillingController } from './recurring-billing/recurring-billing.controller';
import { RecurringBillingSchedulerService } from './recurring-billing/recurring-billing-scheduler.service';

import { CrmModule } from '../crm/crm.module';
// For ConversationsService (InvoiceReminderService's outbound send). Safe: CommunicationModule
// imports Crm/Identity/Audit/Email/Integrations modules, none of which imports FinanceModule.
import { CommunicationModule } from '../communication/communication.module';
import { InvoiceReminderService } from './invoices/invoice-reminder.service';
import { CountersModule } from '../core/counters/counters.module';
import { AuditModule } from '../audit/audit.module';
import { IntegrationWebhookModule } from '../integrations/webhooks/integration-webhook.module';
// For MembershipsService (TimeEntriesService's staff-default-rate lookup). Safe: IdentityModule
// imports neither FinanceModule nor anything that transitively does (verified by grepping every
// `import { IdentityModule }` site — only Organizations/Subscriptions/Communication/AppModule —
// before adding this edge, per this codebase's own "check the reverse edge first" convention).
import { IdentityModule } from '../identity/identity.module';
// For OrganizationsService (invoice/quote PDF header). Safe: OrganizationsModule imports
// IdentityModule/AuditModule/SubscriptionsModule, none of which imports FinanceModule or
// anything that transitively does (verified by grepping every `import { FinanceModule }` site).
import { OrganizationsModule } from '../organizations/organizations.module';
import { DocumentsModule } from '../documents/documents.module';

import { CounterPaymentsService } from './counter/counter-payments.service';
import { TillService } from './counter/till.service';
import {
  TillClosing,
  TillClosingSchema,
} from './counter/schemas/till-closing.schema';
import { CounterPaymentsController } from './counter/counter-payments.controller';
import { WalletService } from './wallet/wallet.service';
import { WalletStatementService } from './wallet/wallet-statement.service';
import { GiftCardsService } from './gift-cards/gift-cards.service';
import { GiftCardsController } from './gift-cards/gift-cards.controller';
import {
  GiftCard,
  GiftCardSchema,
} from './gift-cards/schemas/gift-card.schema';
import {
  Organization,
  OrganizationSchema,
} from '../organizations/schemas/organization.schema';
import { BusinessAlertsModule } from '../business-alerts/business-alerts.module';
import { WalletController } from './wallet/wallet.controller';
import {
  WalletEntry,
  WalletEntrySchema,
} from './wallet/schemas/wallet-entry.schema';
import { Payout, PayoutSchema } from './wallet/schemas/payout.schema';
import {
  WalletSettings,
  WalletSettingsSchema,
} from './wallet/schemas/wallet-settings.schema';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { EmailModule } from '../shared/email/email.module';

@Module({
  imports: [
    BusinessAlertsModule,
    MongooseModule.forFeature([
      { name: Quote.name, schema: QuoteSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: Expense.name, schema: ExpenseSchema },
      { name: TimeEntry.name, schema: TimeEntrySchema },
      { name: DiscountCode.name, schema: DiscountCodeSchema },
      { name: RecurringBilling.name, schema: RecurringBillingSchema },
      { name: Offer.name, schema: OfferSchema },
      { name: Contact.name, schema: ContactSchema },
      { name: TillClosing.name, schema: TillClosingSchema },
      { name: WalletEntry.name, schema: WalletEntrySchema },
      { name: Payout.name, schema: PayoutSchema },
      { name: WalletSettings.name, schema: WalletSettingsSchema },
      { name: Organization.name, schema: OrganizationSchema },
      { name: GiftCard.name, schema: GiftCardSchema },
    ]),
    // Le Solde KORVA reads the plan (commission, withdrawal rules) and e-mails the withdrawal
    // number's confirmation code. Neither module imports FinanceModule.
    SubscriptionsModule,
    EmailModule,
    CrmModule,
    CommunicationModule,
    CountersModule,
    AuditModule,
    IntegrationWebhookModule,
    IntegrationsModule,
    IdentityModule,
    OrganizationsModule,
    DocumentsModule,
  ],
  controllers: [
    GiftCardsController,
    QuotesController,
    InvoicesController,
    PaymentsController,
    ExpensesController,
    TimeEntriesController,
    DiscountCodesController,
    RecurringBillingController,
    FlutterwaveWebhookController,
    PaystackWebhookController,
    GeniusPayWebhookController,
    WalletController,
    CounterPaymentsController,
  ],
  providers: [
    WalletService,
    WalletStatementService,
    GiftCardsService,
    CounterPaymentsService,
    TillService,
    InvoiceReminderService,
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
    // The staff dashboard's "record a payment" flow (PaymentsController.create with no
    // explicit provider argument) still goes exclusively through ManualPaymentProvider — a
    // manually-recorded payment (cash, bank transfer, ...) was collected outside KORVA
    // entirely, so there is no real PSP to call regardless of what the organization has
    // connected. Customer-initiated ONLINE payments (see PublicService's checkout flow) resolve
    // a real PSP per-organization via PaymentProviderResolverService (now imported from
    // IntegrationsModule below — the earlier belief that this import direction was circular was
    // based on a different, incorrect wiring attempt; see IntegrationsModule's own doc comment).
    { provide: PAYMENT_PROVIDER, useClass: ManualPaymentProvider },
    ExpensesRepository,
    ExpensesService,
    TimeEntriesRepository,
    TimeEntriesService,
    DiscountCodesRepository,
    DiscountCodesService,
    RecurringBillingRepository,
    RecurringBillingService,
    RecurringBillingSchedulerService,
  ],
  exports: [
    GiftCardsService,
    WalletService,
    InvoicesService,
    QuotesService,
    PaymentReconciliationService,
    DiscountCodesService,
    RecurringBillingService,
    PaymentsService,
  ],
})
export class FinanceModule {}
