import { randomInt } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { CreateGiftCardInput } from '@korva/validation';
import { GiftCard, type GiftCardDocument } from './schemas/gift-card.schema';
import { PaymentsService } from '../payments/payments.service';
import { InvoicesService } from '../invoices/invoices.service';
import { OrganizationsService } from '../../organizations/organizations.service';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from '../../communication/providers/email-provider.interface';
import { intlLocaleOf, translator } from '../../shared/i18n';

/** No 0/O, 1/I/L: a code read aloud or copied from a card must not be mistyped. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function newCode(): string {
  const part = () =>
    Array.from(
      { length: 4 },
      () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
    ).join('');
  return `KDO-${part()}-${part()}`;
}

/** What a customer types: case, spaces and dashes do not matter. */
export function normalizeGiftCardCode(code: string): string {
  const raw = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const body = raw.startsWith('KDO') ? raw.slice(3) : raw;
  return body.length === 8
    ? `KDO-${body.slice(0, 4)}-${body.slice(4)}`
    : code.trim().toUpperCase();
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Les cartes cadeaux. Issued by the business (sold at the counter, or offered), spent like money
 * on any invoice: paying with one is a "gift_card" payment, so the invoice, the order and the
 * "Bénéfice du mois" see it like any other — the cash taken when the card was sold is the
 * business's own till, never counted twice.
 */
@Injectable()
export class GiftCardsService {
  private readonly logger = new Logger(GiftCardsService.name);

  constructor(
    @InjectModel(GiftCard.name)
    private readonly giftCardModel: Model<GiftCardDocument>,
    private readonly paymentsService: PaymentsService,
    private readonly invoicesService: InvoicesService,
    private readonly organizationsService: OrganizationsService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  async create(
    organizationId: string,
    input: CreateGiftCardInput,
  ): Promise<GiftCardDocument> {
    const organization =
      await this.organizationsService.getById(organizationId);
    let card: GiftCardDocument | undefined;
    for (let attempt = 0; attempt < 5 && !card; attempt += 1) {
      try {
        card = await this.giftCardModel.create({
          organizationId: new Types.ObjectId(organizationId),
          code: newCode(),
          initialAmount: input.amount,
          balance: input.amount,
          currency: organization.currency,
          recipientName: input.recipientName,
          recipientEmail: input.recipientEmail,
          message: input.message,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        });
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
    }
    if (!card) throw new Error('Could not generate a unique gift card code');
    if (input.recipientEmail && input.sendEmail)
      await this.sendToRecipient(card, organization);
    return card;
  }

  list(organizationId: string): Promise<GiftCardDocument[]> {
    return this.giftCardModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ createdAt: -1 })
      .limit(500)
      .exec();
  }

  async disable(organizationId: string, id: string): Promise<GiftCardDocument> {
    const card = await this.giftCardModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        { $set: { status: 'disabled' } },
        { new: true },
      )
      .exec();
    if (!card)
      throw new NotFoundException({
        code: 'GIFT_CARD_NOT_FOUND',
        message: 'Gift card not found',
      });
    return card;
  }

  /** The card a code names — usable or not, said plainly. */
  async findByCode(
    organizationId: string,
    code: string,
  ): Promise<GiftCardDocument> {
    const card = await this.giftCardModel
      .findOne({
        organizationId: new Types.ObjectId(organizationId),
        code: normalizeGiftCardCode(code),
      })
      .exec();
    if (!card)
      throw new NotFoundException({
        code: 'GIFT_CARD_NOT_FOUND',
        message: 'No gift card with this code',
      });
    return card;
  }

  /**
   * Pays `invoiceId` with the card — its whole balance at most, the invoice's remaining amount at
   * most. The balance is debited atomically first (never below zero, never a disabled or expired
   * card); if recording the payment then fails, the amount goes back on the card.
   */
  async payInvoice(
    organizationId: string,
    userId: string | undefined,
    code: string,
    invoiceId: string,
    wanted?: number,
  ): Promise<{ amount: number; balance: number }> {
    const card = await this.findByCode(organizationId, code);
    this.assertUsable(card);
    const invoice = await this.invoicesService.getById(
      organizationId,
      invoiceId,
    );
    if (invoice.currency !== card.currency) {
      throw new BadRequestException({
        code: 'GIFT_CARD_CURRENCY',
        message: 'This gift card is in another currency',
      });
    }
    const remaining = round2(invoice.total - invoice.amountPaid);
    const amount = round2(
      Math.min(card.balance, remaining, wanted ?? Number.POSITIVE_INFINITY),
    );
    if (amount <= 0) {
      throw new BadRequestException({
        code: 'GIFT_CARD_NOTHING_TO_PAY',
        message: 'Nothing left to pay with this card',
      });
    }
    const debited = await this.giftCardModel
      .findOneAndUpdate(
        {
          _id: card._id,
          status: 'active',
          balance: { $gte: amount },
          $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
        },
        {
          $inc: { balance: -amount },
          $push: { uses: { invoiceId: invoice._id, amount, at: new Date() } },
        },
        { new: true },
      )
      .exec();
    if (!debited) {
      throw new BadRequestException({
        code: 'GIFT_CARD_NOT_USABLE',
        message: 'This gift card cannot pay this amount',
      });
    }
    try {
      await this.paymentsService.create(organizationId, userId, {
        invoiceId,
        amount,
        method: 'gift_card',
      });
    } catch (error) {
      await this.giftCardModel
        .updateOne(
          { _id: card._id },
          {
            $inc: { balance: amount },
            $pull: { uses: { invoiceId: invoice._id, amount } },
          },
        )
        .exec();
      throw error;
    }
    return { amount, balance: round2(debited.balance) };
  }

  assertUsable(card: GiftCardDocument): void {
    if (card.status !== 'active') {
      throw new BadRequestException({
        code: 'GIFT_CARD_DISABLED',
        message: 'This gift card is no longer valid',
      });
    }
    if (card.expiresAt && card.expiresAt <= new Date()) {
      throw new BadRequestException({
        code: 'GIFT_CARD_EXPIRED',
        message: 'This gift card has expired',
      });
    }
    if (card.balance <= 0) {
      throw new BadRequestException({
        code: 'GIFT_CARD_EMPTY',
        message: 'This gift card has been fully used',
      });
    }
  }

  async resend(organizationId: string, id: string): Promise<void> {
    const card = await this.giftCardModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
    if (!card?.recipientEmail) {
      throw new BadRequestException({
        code: 'GIFT_CARD_NO_EMAIL',
        message: 'This gift card has no recipient e-mail',
      });
    }
    await this.sendToRecipient(
      card,
      await this.organizationsService.getById(organizationId),
    );
  }

  private async sendToRecipient(
    card: GiftCardDocument,
    organization: { name: string; language?: string; slug: string },
  ): Promise<void> {
    const t = translator(organization.language);
    const amount = new Intl.NumberFormat(intlLocaleOf(organization.language), {
      style: 'currency',
      currency: card.currency,
    }).format(card.initialAmount);
    const site = `${(process.env.STOREFRONT_URL ?? 'http://localhost:3001').replace(/\/$/, '')}/${organization.slug}`;
    const name = escapeHtml(organization.name);
    await this.emailProvider
      .send({
        to: card.recipientEmail!,
        subject: t(
          `Une carte cadeau ${organization.name} de ${amount} pour vous`,
          `A ${amount} ${organization.name} gift card for you`,
        ),
        body:
          t(
            `<p>Bonjour ${escapeHtml(card.recipientName ?? '')},</p><p>Vous avez reçu une carte cadeau <strong>${name}</strong> de <strong>${amount}</strong>.</p>`,
            `<p>Hello ${escapeHtml(card.recipientName ?? '')},</p><p>You have received a <strong>${name}</strong> gift card worth <strong>${amount}</strong>.</p>`,
          ) +
          (card.message
            ? `<blockquote style="margin:0;padding:8px 12px;border-left:3px solid #ccc">${escapeHtml(card.message)}</blockquote>`
            : '') +
          t(
            `<p>Votre code : <strong style="font-size:20px;letter-spacing:2px">${card.code}</strong></p><p>Donnez-le en boutique, ou tapez-le en payant sur <a href="${site}">${site}</a>.</p>`,
            `<p>Your code: <strong style="font-size:20px;letter-spacing:2px">${card.code}</strong></p><p>Give it in store, or type it when paying on <a href="${site}">${site}</a>.</p>`,
          ),
      })
      .catch((error: unknown) =>
        this.logger.warn(`Gift card e-mail not sent: ${String(error)}`),
      );
  }
}
