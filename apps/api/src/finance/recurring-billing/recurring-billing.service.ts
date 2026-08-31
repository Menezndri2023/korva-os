import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { Pagination } from '@korva/types';
import type { CreateRecurringBillingInput } from '@korva/validation';
import {
  RecurringBillingRepository,
  FindRecurringBillingsOptions,
} from './recurring-billing.repository';
import { RecurringBillingDocument } from './schemas/recurring-billing.schema';
import { ContactsService } from '../../crm/contacts/contacts.service';
import {
  Offer,
  OfferDocument,
} from '../../catalog/offers/schemas/offer.schema';
import { AuditService } from '../../audit/audit.service';
import { EventBusService } from '../../core/events/event-bus.service';

function addInterval(date: Date, interval: 'monthly' | 'yearly'): Date {
  const next = new Date(date);
  if (interval === 'monthly') {
    next.setMonth(next.getMonth() + 1);
  } else {
    next.setFullYear(next.getFullYear() + 1);
  }
  return next;
}

@Injectable()
export class RecurringBillingService {
  constructor(
    private readonly recurringBillingRepository: RecurringBillingRepository,
    private readonly contactsService: ContactsService,
    private readonly auditService: AuditService,
    private readonly eventBus: EventBusService,
    @InjectModel(Offer.name) private readonly offerModel: Model<OfferDocument>,
  ) {}

  /** Mirrors OffersService.getById exactly (same NOT_FOUND shape) — direct model access, not
   *  `OffersService`, since CatalogModule already imports FinanceModule (for
   *  OfferReferencesRepository), so importing CatalogModule back here would be circular. */
  private async getOffer(
    organizationId: string,
    offerId: string,
  ): Promise<OfferDocument> {
    const offer = await this.offerModel
      .findOne({
        _id: new Types.ObjectId(offerId),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
    if (!offer) {
      throw new NotFoundException({
        code: 'OFFER_NOT_FOUND',
        message: 'Offer not found',
      });
    }
    return offer;
  }

  async create(
    organizationId: string,
    userId: string,
    input: CreateRecurringBillingInput,
  ): Promise<RecurringBillingDocument> {
    const contactExists = await this.contactsService.existsById(
      organizationId,
      input.contactId,
    );
    if (!contactExists) {
      throw new NotFoundException({
        code: 'CONTACT_NOT_FOUND',
        message: 'Contact not found',
      });
    }

    // The offer's price is snapshotted below — a later price change on the offer never
    // silently changes what an already-created plan bills (same principle as every other
    // price snapshot in this codebase: order/quote/invoice line items, booking pricing, ...).
    const offer = await this.getOffer(organizationId, input.offerId);

    const recurringBilling = await this.recurringBillingRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      contactId: new Types.ObjectId(input.contactId),
      offerId: new Types.ObjectId(input.offerId),
      interval: input.interval,
      status: 'active',
      amount: offer.pricing.amount,
      currency: offer.pricing.currency,
      nextBillingDate: addInterval(new Date(), input.interval),
    });

    await this.auditService.record({
      organizationId,
      userId,
      action: 'CREATE',
      entity: 'recurring_billing',
      entityId: recurringBilling.id as string,
    });
    await this.eventBus.publish(organizationId, 'recurring_billing.created', {
      recurringBillingId: recurringBilling.id as string,
      contactId: input.contactId,
    });

    return recurringBilling;
  }

  async getById(
    organizationId: string,
    id: string,
  ): Promise<RecurringBillingDocument> {
    const recurringBilling = await this.recurringBillingRepository.findById(
      organizationId,
      id,
    );
    if (!recurringBilling) {
      throw new NotFoundException({
        code: 'RECURRING_BILLING_NOT_FOUND',
        message: 'Recurring billing plan not found',
      });
    }
    return recurringBilling;
  }

  async list(
    organizationId: string,
    query: FindRecurringBillingsOptions,
  ): Promise<{ data: RecurringBillingDocument[]; pagination: Pagination }> {
    const { data, total } = await this.recurringBillingRepository.findAll(
      organizationId,
      query,
    );
    return {
      data,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.limit)),
      },
    };
  }

  async cancel(
    organizationId: string,
    userId: string,
    id: string,
  ): Promise<RecurringBillingDocument> {
    const updated = await this.recurringBillingRepository.cancel(
      organizationId,
      id,
    );
    if (!updated) {
      const existing = await this.recurringBillingRepository.findById(
        organizationId,
        id,
      );
      if (!existing) {
        throw new NotFoundException({
          code: 'RECURRING_BILLING_NOT_FOUND',
          message: 'Recurring billing plan not found',
        });
      }
      throw new BadRequestException({
        code: 'RECURRING_BILLING_ALREADY_CANCELLED',
        message: 'This recurring billing plan is already cancelled',
      });
    }

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'recurring_billing',
      entityId: id,
      metadata: { status: 'cancelled' },
    });
    await this.eventBus.publish(organizationId, 'recurring_billing.cancelled', {
      recurringBillingId: id,
      contactId: updated.contactId.toString(),
    });

    return updated;
  }
}

export { addInterval };
