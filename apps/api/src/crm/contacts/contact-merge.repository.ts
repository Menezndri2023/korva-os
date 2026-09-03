import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { Lead, LeadDocument } from '../leads/schemas/lead.schema';
import { Task, TaskDocument } from '../tasks/schemas/task.schema';
import {
  Activity,
  ActivityDocument,
} from '../activities/schemas/activity.schema';
import { Note, NoteDocument } from '../notes/schemas/note.schema';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import {
  Order,
  OrderDocument,
} from '../../commerce/orders/schemas/order.schema';
import { Cart, CartDocument } from '../../commerce/carts/schemas/cart.schema';
import {
  ReturnRequest,
  ReturnRequestDocument,
} from '../../commerce/returns/schemas/return-request.schema';
import {
  WishlistItem,
  WishlistItemDocument,
} from '../../commerce/wishlist/schemas/wishlist-item.schema';
import {
  Booking,
  BookingDocument,
} from '../../booking/bookings/schemas/booking.schema';
import {
  WaitlistEntry,
  WaitlistEntryDocument,
} from '../../booking/waitlist/schemas/waitlist-entry.schema';
import {
  CreditBalance,
  CreditBalanceDocument,
} from '../../booking/credit-balances/schemas/credit-balance.schema';
import {
  QuizAttempt,
  QuizAttemptDocument,
} from '../../booking/courses/schemas/quiz.schema';
import {
  Cohort,
  CohortDocument,
} from '../../booking/courses/schemas/cohort.schema';
import {
  Invoice,
  InvoiceDocument,
} from '../../finance/invoices/schemas/invoice.schema';
import {
  Quote,
  QuoteDocument,
} from '../../finance/quotes/schemas/quote.schema';
import {
  RecurringBilling,
  RecurringBillingDocument,
} from '../../finance/recurring-billing/schemas/recurring-billing.schema';
import {
  Expense,
  ExpenseDocument,
} from '../../finance/expenses/schemas/expense.schema';
import {
  TimeEntry,
  TimeEntryDocument,
} from '../../finance/time-entries/schemas/time-entry.schema';
import {
  Conversation,
  ConversationDocument,
} from '../../communication/conversations/schemas/conversation.schema';
import {
  CustomerAccount,
  CustomerAccountDocument,
} from '../../customer-auth/schemas/customer-account.schema';
import { Review, ReviewDocument } from '../../reviews/schemas/review.schema';

/**
 * Every collection ContactReferencesRepository's delete-guard did NOT check (that one only
 * covers the 7 collections whose contactId a plain delete would orphan visibly — see its own
 * doc comment) PLUS those same 7, because a merge must re-point everything a delete-guard would
 * ever need to know about, not just what blocks a delete today. Direct @InjectModel, same
 * circular-dependency rationale as ContactReferencesRepository: Commerce/Booking/Finance/
 * Communication/CustomerAuth/Reviews all already depend on CrmModule.
 */
@Injectable()
export class ContactMergeRepository {
  constructor(
    @InjectModel(Lead.name) private readonly leadModel: Model<LeadDocument>,
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
    @InjectModel(Activity.name)
    private readonly activityModel: Model<ActivityDocument>,
    @InjectModel(Note.name) private readonly noteModel: Model<NoteDocument>,
    @InjectModel(Project.name)
    private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Cart.name) private readonly cartModel: Model<CartDocument>,
    @InjectModel(ReturnRequest.name)
    private readonly returnRequestModel: Model<ReturnRequestDocument>,
    @InjectModel(WishlistItem.name)
    private readonly wishlistItemModel: Model<WishlistItemDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(WaitlistEntry.name)
    private readonly waitlistEntryModel: Model<WaitlistEntryDocument>,
    @InjectModel(CreditBalance.name)
    private readonly creditBalanceModel: Model<CreditBalanceDocument>,
    @InjectModel(QuizAttempt.name)
    private readonly quizAttemptModel: Model<QuizAttemptDocument>,
    @InjectModel(Cohort.name)
    private readonly cohortModel: Model<CohortDocument>,
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(Quote.name) private readonly quoteModel: Model<QuoteDocument>,
    @InjectModel(RecurringBilling.name)
    private readonly recurringBillingModel: Model<RecurringBillingDocument>,
    @InjectModel(Expense.name)
    private readonly expenseModel: Model<ExpenseDocument>,
    @InjectModel(TimeEntry.name)
    private readonly timeEntryModel: Model<TimeEntryDocument>,
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(CustomerAccount.name)
    private readonly customerAccountModel: Model<CustomerAccountDocument>,
    @InjectModel(Review.name)
    private readonly reviewModel: Model<ReviewDocument>,
  ) {}

  /**
   * Re-points every reference from `duplicateId` to `primaryId`, all within the caller's
   * transaction. Order matters only for CustomerAccount (checked first, since it's the one
   * case that can make the whole merge impossible — see below); everything else is an
   * unconditional bulk update, safe to run in any order.
   */
  async repointAll(
    organizationId: string,
    primaryId: string,
    duplicateId: string,
    session: ClientSession,
  ): Promise<void> {
    const orgObjectId = new Types.ObjectId(organizationId);
    const primaryObjectId = new Types.ObjectId(primaryId);
    const duplicateObjectId = new Types.ObjectId(duplicateId);

    await this.repointCustomerAccount(
      orgObjectId,
      primaryObjectId,
      duplicateObjectId,
      session,
    );

    const contactIdFilter = {
      organizationId: orgObjectId,
      contactId: duplicateObjectId,
    };
    const contactIdUpdate = { $set: { contactId: primaryObjectId } };
    // Mongoose's Model<T> generics don't survive being collected into a shared array (each
    // model's document shape is invariant in ways TypeScript can't reconcile through a common
    // "{ contactId }" supertype) — explicit calls, not a loop, is the straightforward fix.
    await Promise.all([
      this.leadModel.updateMany(contactIdFilter, contactIdUpdate, { session }),
      this.projectModel.updateMany(contactIdFilter, contactIdUpdate, {
        session,
      }),
      this.orderModel.updateMany(contactIdFilter, contactIdUpdate, { session }),
      this.cartModel.updateMany(contactIdFilter, contactIdUpdate, { session }),
      this.returnRequestModel.updateMany(contactIdFilter, contactIdUpdate, {
        session,
      }),
      this.wishlistItemModel.updateMany(contactIdFilter, contactIdUpdate, {
        session,
      }),
      this.bookingModel.updateMany(contactIdFilter, contactIdUpdate, {
        session,
      }),
      this.waitlistEntryModel.updateMany(contactIdFilter, contactIdUpdate, {
        session,
      }),
      this.creditBalanceModel.updateMany(contactIdFilter, contactIdUpdate, {
        session,
      }),
      this.quizAttemptModel.updateMany(contactIdFilter, contactIdUpdate, {
        session,
      }),
      this.invoiceModel.updateMany(contactIdFilter, contactIdUpdate, {
        session,
      }),
      this.quoteModel.updateMany(contactIdFilter, contactIdUpdate, { session }),
      this.recurringBillingModel.updateMany(contactIdFilter, contactIdUpdate, {
        session,
      }),
      this.expenseModel.updateMany(contactIdFilter, contactIdUpdate, {
        session,
      }),
      this.timeEntryModel.updateMany(contactIdFilter, contactIdUpdate, {
        session,
      }),
      this.conversationModel.updateMany(contactIdFilter, contactIdUpdate, {
        session,
      }),
      this.reviewModel.updateMany(contactIdFilter, contactIdUpdate, {
        session,
      }),
    ]);

    // Polymorphic entity/entityId collections — 'contact' is the literal discriminator value
    // for "this row is about a Contact" on all three.
    const entityIdFilter = {
      organizationId: orgObjectId,
      entity: 'contact' as const,
      entityId: duplicateObjectId,
    };
    const entityIdUpdate = { $set: { entityId: primaryObjectId } };
    await Promise.all([
      this.taskModel.updateMany(entityIdFilter, entityIdUpdate, { session }),
      this.activityModel.updateMany(entityIdFilter, entityIdUpdate, {
        session,
      }),
      this.noteModel.updateMany(entityIdFilter, entityIdUpdate, { session }),
    ]);

    await this.repointCohortEnrollment(
      orgObjectId,
      primaryObjectId,
      duplicateObjectId,
      session,
    );
  }

  /**
   * A contact can have at most one CustomerAccount (unique {organizationId, contactId} index —
   * see that schema's own doc). If only the duplicate has one, it transfers cleanly. If the
   * PRIMARY already has one too, transferring the duplicate's would violate that unique index —
   * two independent customer-portal logins can't be silently collapsed into one (which
   * password survives? which login history?), so this merge is refused outright rather than
   * silently dropping one account.
   */
  private async repointCustomerAccount(
    organizationId: Types.ObjectId,
    primaryId: Types.ObjectId,
    duplicateId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    const [primaryAccount, duplicateAccount] = await Promise.all([
      this.customerAccountModel
        .exists({ organizationId, contactId: primaryId })
        .session(session),
      this.customerAccountModel
        .exists({ organizationId, contactId: duplicateId })
        .session(session),
    ]);
    if (!duplicateAccount) return;
    if (primaryAccount) {
      throw new ConflictException({
        code: 'CONTACT_MERGE_BOTH_HAVE_CUSTOMER_ACCOUNTS',
        message:
          'Both contacts have their own customer portal login — merge the accounts manually before merging these contacts',
      });
    }
    await this.customerAccountModel.updateOne(
      { organizationId, contactId: duplicateId },
      { $set: { contactId: primaryId } },
      { session },
    );
  }

  /**
   * enrolledContactIds is an array, not a scalar contactId — a positional $set would only
   * touch the first matching element and could leave the primary listed twice if it was
   * already enrolled in the same cohort. Pull the duplicate out, then $addToSet the primary in
   * (idempotent even if the primary was already there), for every cohort where the duplicate
   * appeared.
   */
  private async repointCohortEnrollment(
    organizationId: Types.ObjectId,
    primaryId: Types.ObjectId,
    duplicateId: Types.ObjectId,
    session: ClientSession,
  ): Promise<void> {
    const affected = await this.cohortModel
      .find({ organizationId, enrolledContactIds: duplicateId }, { _id: 1 })
      .session(session)
      .exec();
    if (affected.length === 0) return;

    const ids = affected.map((c) => c._id);
    await this.cohortModel.updateMany(
      { _id: { $in: ids } },
      { $pull: { enrolledContactIds: duplicateId } },
      { session },
    );
    await this.cohortModel.updateMany(
      { _id: { $in: ids } },
      { $addToSet: { enrolledContactIds: primaryId } },
      { session },
    );
  }
}
