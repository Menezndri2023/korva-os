import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Contact, ContactSchema } from './contacts/schemas/contact.schema';
import { Lead, LeadSchema } from './leads/schemas/lead.schema';
import { Deal, DealSchema } from './deals/schemas/deal.schema';
import { Pipeline, PipelineSchema } from './pipelines/schemas/pipeline.schema';
import { Activity, ActivitySchema } from './activities/schemas/activity.schema';
import { Task, TaskSchema } from './tasks/schemas/task.schema';
import { Note, NoteSchema } from './notes/schemas/note.schema';
import { Tag, TagSchema } from './tags/schemas/tag.schema';

// Registered here (not by importing CommerceModule/BookingModule/FinanceModule/
// CommunicationModule) so ContactReferencesRepository can check for references without a
// circular module dependency — all four of those modules already import CrmModule. Same fix
// as subscriptions.service.ts's direct Organization model injection; see
// contact-references.repository.ts for the full rationale.
import { Order, OrderSchema } from '../commerce/orders/schemas/order.schema';
import { Cart, CartSchema } from '../commerce/carts/schemas/cart.schema';
import {
  Booking,
  BookingSchema,
} from '../booking/bookings/schemas/booking.schema';
import {
  Invoice,
  InvoiceSchema,
} from '../finance/invoices/schemas/invoice.schema';
import { Quote, QuoteSchema } from '../finance/quotes/schemas/quote.schema';
import {
  Conversation,
  ConversationSchema,
} from '../communication/conversations/schemas/conversation.schema';
// Same rationale as Invoice/Quote above — FinanceModule already imports CrmModule (for
// ContactsService), so ProjectsService needs read-only access to TimeEntry without CrmModule
// importing FinanceModule back (which would be circular).
import {
  TimeEntry,
  TimeEntrySchema,
} from '../finance/time-entries/schemas/time-entry.schema';
// The rest of Contact's referencing collections, needed by ContactMergeRepository (merging two
// duplicate contacts must re-point every one of them, not just the seven ContactReferencesRepository
// already knew about for delete-protection) — same circular-dependency rationale as above.
import {
  CustomerAccount,
  CustomerAccountSchema,
} from '../customer-auth/schemas/customer-account.schema';
import {
  ReturnRequest,
  ReturnRequestSchema,
} from '../commerce/returns/schemas/return-request.schema';
import {
  WishlistItem,
  WishlistItemSchema,
} from '../commerce/wishlist/schemas/wishlist-item.schema';
import {
  WaitlistEntry,
  WaitlistEntrySchema,
} from '../booking/waitlist/schemas/waitlist-entry.schema';
import {
  CreditBalance,
  CreditBalanceSchema,
} from '../booking/credit-balances/schemas/credit-balance.schema';
import {
  QuizAttempt,
  QuizAttemptSchema,
} from '../booking/courses/schemas/quiz.schema';
import { Cohort, CohortSchema } from '../booking/courses/schemas/cohort.schema';
import {
  RecurringBilling,
  RecurringBillingSchema,
} from '../finance/recurring-billing/schemas/recurring-billing.schema';
import {
  Expense,
  ExpenseSchema,
} from '../finance/expenses/schemas/expense.schema';
import { Review, ReviewSchema } from '../reviews/schemas/review.schema';

import { ContactsRepository } from './contacts/contacts.repository';
import { ContactReferencesRepository } from './contacts/contact-references.repository';
import { ContactMergeRepository } from './contacts/contact-merge.repository';
import { ContactsService } from './contacts/contacts.service';
import { ContactsController } from './contacts/contacts.controller';
import { CustomerInactivitySchedulerService } from './contacts/customer-inactivity-scheduler.service';

import { LeadsRepository } from './leads/leads.repository';
import { LeadsService } from './leads/leads.service';
import { LeadsController } from './leads/leads.controller';

import { DealsRepository } from './deals/deals.repository';
import { DealsService } from './deals/deals.service';
import { DealsController } from './deals/deals.controller';

import { PipelinesRepository } from './pipelines/pipelines.repository';
import { PipelinesService } from './pipelines/pipelines.service';
import { PipelinesController } from './pipelines/pipelines.controller';

import { ActivitiesRepository } from './activities/activities.repository';
import { ActivitiesService } from './activities/activities.service';
import { ActivitiesController } from './activities/activities.controller';

import { TasksRepository } from './tasks/tasks.repository';
import { TasksService } from './tasks/tasks.service';
import { TasksController } from './tasks/tasks.controller';

import { NotesRepository } from './notes/notes.repository';
import { NotesService } from './notes/notes.service';
import { NotesController } from './notes/notes.controller';

import { TagsRepository } from './tags/tags.repository';
import { TagsService } from './tags/tags.service';
import { TagsController } from './tags/tags.controller';

import { ProjectsRepository } from './projects/projects.repository';
import { ProjectsService } from './projects/projects.service';
import { ProjectsController } from './projects/projects.controller';
import { Project, ProjectSchema } from './projects/schemas/project.schema';

import { CustomFieldsModule } from '../custom-fields/custom-fields.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Contact.name, schema: ContactSchema },
      { name: Lead.name, schema: LeadSchema },
      { name: Deal.name, schema: DealSchema },
      { name: Pipeline.name, schema: PipelineSchema },
      { name: Activity.name, schema: ActivitySchema },
      { name: Task.name, schema: TaskSchema },
      { name: Note.name, schema: NoteSchema },
      { name: Tag.name, schema: TagSchema },
      { name: Order.name, schema: OrderSchema },
      { name: Cart.name, schema: CartSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Invoice.name, schema: InvoiceSchema },
      { name: Quote.name, schema: QuoteSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: TimeEntry.name, schema: TimeEntrySchema },
      { name: Project.name, schema: ProjectSchema },
      { name: CustomerAccount.name, schema: CustomerAccountSchema },
      { name: ReturnRequest.name, schema: ReturnRequestSchema },
      { name: WishlistItem.name, schema: WishlistItemSchema },
      { name: WaitlistEntry.name, schema: WaitlistEntrySchema },
      { name: CreditBalance.name, schema: CreditBalanceSchema },
      { name: QuizAttempt.name, schema: QuizAttemptSchema },
      { name: Cohort.name, schema: CohortSchema },
      { name: RecurringBilling.name, schema: RecurringBillingSchema },
      { name: Expense.name, schema: ExpenseSchema },
      { name: Review.name, schema: ReviewSchema },
    ]),
    CustomFieldsModule,
    AuditModule,
  ],
  controllers: [
    ContactsController,
    LeadsController,
    DealsController,
    PipelinesController,
    ActivitiesController,
    TasksController,
    NotesController,
    TagsController,
    ProjectsController,
  ],
  providers: [
    ContactsRepository,
    ContactReferencesRepository,
    ContactMergeRepository,
    ContactsService,
    CustomerInactivitySchedulerService,
    LeadsRepository,
    LeadsService,
    DealsRepository,
    DealsService,
    PipelinesRepository,
    PipelinesService,
    ActivitiesRepository,
    ActivitiesService,
    TasksRepository,
    TasksService,
    NotesRepository,
    NotesService,
    TagsRepository,
    TagsService,
    ProjectsRepository,
    ProjectsService,
  ],
  exports: [
    ContactsService,
    TasksService,
    LeadsService,
    DealsService,
    NotesService,
    PipelinesService,
    ProjectsService,
  ],
})
export class CrmModule {}
