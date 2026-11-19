import { BadRequestException, Injectable } from '@nestjs/common';
import { OffersService } from '../../catalog/offers/offers.service';
import { InvoicesService } from '../../finance/invoices/invoices.service';
import { PaymentsService } from '../../finance/payments/payments.service';
import type { OrderDocument } from './schemas/order.schema';

export interface DonationReceiptData {
  /** The order's number — the receipt carries it, so a donor and the association quote the same one. */
  number: string;
  lines: { description: string; amount: number }[];
  total: number;
  currency: string;
  /** When the money was received: the latest completed payment on the order's invoice. */
  receivedAt: Date;
}

/**
 * What a donation receipt states, for an order holding donations (lines on a free-amount offer,
 * Offer.freeAmount). Only once the money is actually received: the invoice is paid and no
 * payment was refunded — a receipt for a promised or reimbursed gift would be false.
 *
 * Deliberately NOT a tax receipt. KORVA is used across West Africa and beyond, and whether a
 * gift is deductible depends on the country and on the association's recognized status — a
 * document that implied it would expose the association. The template says so in plain words.
 */
@Injectable()
export class DonationReceiptService {
  constructor(
    private readonly offersService: OffersService,
    private readonly invoicesService: InvoicesService,
    private readonly paymentsService: PaymentsService,
  ) {}

  /** Whether resolve() would succeed — what an order view asks before offering the download. */
  async isAvailable(
    organizationId: string,
    order: OrderDocument,
  ): Promise<boolean> {
    try {
      await this.resolve(organizationId, order);
      return true;
    } catch (error) {
      if (error instanceof BadRequestException) return false;
      throw error;
    }
  }

  async resolve(
    organizationId: string,
    order: OrderDocument,
  ): Promise<DonationReceiptData> {
    const lines = await this.donationLines(organizationId, order);
    if (lines.length === 0) {
      throw notAvailable('This order holds no donation');
    }
    if (!order.invoiceId) {
      throw notAvailable('This donation has not been received yet');
    }
    const invoiceId = order.invoiceId.toString();
    const invoice = await this.invoicesService.getById(
      organizationId,
      invoiceId,
    );
    if (invoice.status !== 'paid') {
      throw notAvailable('This donation has not been received yet');
    }
    const payments = await this.paymentsService.list(organizationId, invoiceId);
    if (
      payments.some(
        (p) => p.status === 'refunded' || (p.refundedAmount ?? 0) > 0,
      )
    ) {
      throw notAvailable('This donation was refunded');
    }
    const completed = payments.filter((p) => p.status === 'completed');
    const receivedAt = completed
      .map((p) => (p as unknown as { createdAt?: Date }).createdAt)
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    return {
      number: order.number,
      lines,
      total: lines.reduce((sum, line) => sum + line.amount, 0),
      currency: order.currency,
      receivedAt:
        receivedAt ??
        (invoice as unknown as { updatedAt?: Date }).updatedAt ??
        new Date(),
    };
  }

  private async donationLines(
    organizationId: string,
    order: OrderDocument,
  ): Promise<DonationReceiptData['lines']> {
    const offerIds = [
      ...new Set(
        order.items
          .map((item) => item.offerId?.toString())
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (offerIds.length === 0) return [];
    // Tolerant lookup: an offer deleted since the gift does not make the gift disappear from a
    // receipt — but its line can no longer be told to be a donation, so it is left out.
    const offers = await this.offersService.findManyByIds(
      organizationId,
      offerIds,
    );
    const donationOfferIds = new Set(
      offers
        .filter((offer) => offer.freeAmount)
        .map((offer) => offer.id as string),
    );
    return order.items
      .filter(
        (item) => item.offerId && donationOfferIds.has(item.offerId.toString()),
      )
      .map((item) => ({
        description: item.description,
        amount: item.quantity * item.unitPrice,
      }));
  }
}

function notAvailable(message: string): BadRequestException {
  return new BadRequestException({
    code: 'DONATION_RECEIPT_NOT_AVAILABLE',
    message,
  });
}
