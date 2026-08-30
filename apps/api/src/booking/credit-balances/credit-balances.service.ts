import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { TopUpCreditBalanceInput } from '@korva/validation';
import type { Pagination } from '@korva/types';
import {
  CreditBalancesRepository,
  FindCreditBalancesOptions,
} from './credit-balances.repository';
import { CreditBalanceDocument } from './schemas/credit-balance.schema';
import { ContactsService } from '../../crm/contacts/contacts.service';
import { OffersService } from '../../catalog/offers/offers.service';
import { AuditService } from '../../audit/audit.service';

@Injectable()
export class CreditBalancesService {
  private readonly logger = new Logger(CreditBalancesService.name);

  constructor(
    private readonly creditBalancesRepository: CreditBalancesRepository,
    private readonly contactsService: ContactsService,
    private readonly offersService: OffersService,
    private readonly auditService: AuditService,
  ) {}

  async topUp(
    organizationId: string,
    userId: string,
    input: TopUpCreditBalanceInput,
  ): Promise<CreditBalanceDocument> {
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

    const offer = await this.offersService.getById(
      organizationId,
      input.offerId,
    );
    if (offer.type !== 'package') {
      throw new BadRequestException({
        code: 'OFFER_NOT_A_PACKAGE',
        message: 'Credits can only be granted against a "package"-type offer',
      });
    }

    const balance = await this.creditBalancesRepository.topUp(
      organizationId,
      input.contactId,
      input.offerId,
      input.credits,
    );

    await this.auditService.record({
      organizationId,
      userId,
      action: 'UPDATE',
      entity: 'credit_balance',
      entityId: balance.id as string,
      metadata: { credits: input.credits },
    });

    return balance;
  }

  async getById(
    organizationId: string,
    id: string,
  ): Promise<CreditBalanceDocument> {
    const balance = await this.creditBalancesRepository.findById(
      organizationId,
      id,
    );
    if (!balance) {
      throw new NotFoundException({
        code: 'CREDIT_BALANCE_NOT_FOUND',
        message: 'Credit balance not found',
      });
    }
    return balance;
  }

  async list(
    organizationId: string,
    query: FindCreditBalancesOptions,
  ): Promise<{ data: CreditBalanceDocument[]; pagination: Pagination }> {
    const { data, total } = await this.creditBalancesRepository.findAll(
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

  /**
   * Best-effort — called from BookingsService.complete() when a completed, attended booking's
   * offer is of type 'package'. Never throws: a missing or already-depleted balance (e.g. the
   * client booked a package session without ever buying the pack, or a no-show shouldn't lose a
   * credit — BookingsService only calls this on `attended: true`) simply means nothing is
   * decremented, and the booking completion that already succeeded must never be rolled back or
   * reported as failed over a credit-tracking side effect.
   */
  async decrementForBookingCompletion(
    organizationId: string,
    contactId: string,
    offerId: string,
  ): Promise<void> {
    try {
      const offer = await this.offersService.getById(organizationId, offerId);
      if (offer.type !== 'package') return;

      const updated = await this.creditBalancesRepository.decrementIfAvailable(
        organizationId,
        contactId,
        offerId,
      );
      if (!updated) {
        this.logger.warn(
          `Credit balance: no available credit to decrement for contact ${contactId} / offer ${offerId}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Credit balance: failed to decrement for contact ${contactId} / offer ${offerId}`,
        error,
      );
    }
  }
}
