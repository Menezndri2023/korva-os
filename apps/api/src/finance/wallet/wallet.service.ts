import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { BusinessAlertsService } from '../../business-alerts/business-alerts.service';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { saleCostsInSaleCurrency, type SaleCosts } from './provider-fees';
import { Model, Types } from 'mongoose';
import {
  MIN_PAYOUT_AMOUNT,
  PLAN_COMMISSION_BASIS_POINTS,
  PLAN_PAYOUT_RULES,
  type PlanKey,
  type Payout as PayoutView,
  type PlatformWalletOverview,
  type WalletEntryKind,
  type WalletSummary,
} from '@korva/types';
import type {
  RequestPayoutInput,
  SetPayoutDestinationInput,
  UpdateAutoPayoutInput,
} from '@korva/validation';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from '../../communication/providers/email-provider.interface';
import { OrganizationsService } from '../../organizations/organizations.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { Payment } from '../payments/schemas/payment.schema';
import { PaymentProviderResolverService } from '../payments/providers/payment-provider-resolver.service';
import { isAmbiguousProviderError } from '../payments/providers/payment-provider.interface';
import {
  WalletEntry,
  WalletEntryDocument,
} from './schemas/wallet-entry.schema';
import { Payout, PayoutDocument } from './schemas/payout.schema';
import {
  WalletSettings,
  WalletSettingsDocument,
} from './schemas/wallet-settings.schema';
import { translator, type Translate } from '../../shared/i18n';

const DAY_MS = 86_400_000;
/** A new withdrawal number must be this old before AUTOMATIC withdrawals use it. */
const DESTINATION_COOLDOWN_MS = 2 * DAY_MS;
const CODE_TTL_MS = 15 * 60_000;
const MAX_CODE_ATTEMPTS = 5;
/** A withdrawal sent without an answer is re-sent (same idempotency key) after this. */
const RESEND_AFTER_MS = 2 * 60_000;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 11000
  );
}

/**
 * Le Solde KORVA — formule B (2026-10-28): KORVA collects its businesses' online payments on its
 * own GeniusPay account and pays each business back.
 *
 *   sale ─► + amount, − GeniusPay's fee (read on the payment), − KORVA's commission (plan rate)
 *           all three released after WALLET_HOLD_DAYS (default 3): refunds and fraud first
 *   withdrawal ─► − amount when requested; + amount back if it fails or is refused;
 *                 − GeniusPay's withdrawal fee once paid (every plan since 2026-11-07)
 *
 * Withdrawals are approved by the administration first (PAYOUT_APPROVAL=manual, the default)
 * until GeniusPay has confirmed in writing that KORVA may pay third parties; PAYOUT_APPROVAL=auto
 * sends them as soon as they are requested. Automatic withdrawals (weekly, or daily on Pro and
 * Business) are requested by the sweep below, which runs inside the payment reconciliation
 * scheduler — no Redis loop of its own.
 */
@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectModel(WalletEntry.name)
    private readonly entryModel: Model<WalletEntryDocument>,
    @InjectModel(Payout.name)
    private readonly payoutModel: Model<PayoutDocument>,
    @InjectModel(WalletSettings.name)
    private readonly settingsModel: Model<WalletSettingsDocument>,
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    private readonly organizationsService: OrganizationsService,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly providerResolver: PaymentProviderResolverService,
    private readonly configService: ConfigService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    private readonly businessAlerts: BusinessAlertsService,
  ) {}

  holdDays(): number {
    const days = Number(
      this.configService.get<string>('WALLET_HOLD_DAYS') ?? 3,
    );
    return Number.isFinite(days) && days >= 0 ? days : 3;
  }

  approvalMode(): 'manual' | 'auto' {
    return this.configService.get<string>('PAYOUT_APPROVAL') === 'auto'
      ? 'auto'
      : 'manual';
  }

  /** Notes stored on the business's ledger are written in its language (shared/i18n.ts). */
  private async translatorFor(organizationId: string): Promise<Translate> {
    const organization = await this.organizationsService
      .getById(organizationId)
      .catch(() => null);
    return translator(organization?.language);
  }

  private async planOf(organizationId: string): Promise<PlanKey> {
    return (await this.subscriptionsService.getActivePlan(organizationId))
      .key as PlanKey;
  }

  /* ─────────────────────────── balance ─────────────────────────── */

  async balances(
    organizationId: string,
  ): Promise<{ available: number; pending: number }> {
    const now = new Date();
    const [row] = await this.entryModel
      .aggregate<{ available: number; pending: number }>([
        { $match: { organizationId: new Types.ObjectId(organizationId) } },
        {
          $group: {
            _id: null,
            available: {
              $sum: { $cond: [{ $lte: ['$availableAt', now] }, '$amount', 0] },
            },
            pending: {
              $sum: { $cond: [{ $gt: ['$availableAt', now] }, '$amount', 0] },
            },
          },
        },
      ])
      .exec();
    return {
      available: round2(row?.available ?? 0),
      pending: round2(row?.pending ?? 0),
    };
  }

  async summary(organizationId: string): Promise<WalletSummary> {
    const [organization, plan, { available, pending }, settings, openPayout] =
      await Promise.all([
        this.organizationsService.getById(organizationId),
        this.planOf(organizationId),
        this.balances(organizationId),
        this.settings(organizationId),
        this.payoutModel
          .findOne({
            organizationId: new Types.ObjectId(organizationId),
            open: true,
          })
          .exec(),
      ]);
    const rules = PLAN_PAYOUT_RULES[plan];
    return {
      currency: organization.currency,
      available,
      pending,
      plan,
      commissionBasisPoints: PLAN_COMMISSION_BASIS_POINTS[plan],
      holdDays: this.holdDays(),
      destination: settings?.destination
        ? {
            provider: settings.destination.provider,
            account: settings.destination.account,
            holderName: settings.destination.holderName,
          }
        : null,
      pendingDestination: settings?.pendingDestination
        ? {
            provider: settings.pendingDestination.provider,
            account: settings.pendingDestination.account,
          }
        : null,
      autoPayout: {
        enabled: settings?.autoPayoutEnabled ?? false,
        frequency: settings?.autoPayoutFrequency ?? 'weekly',
        minimum: settings?.autoPayoutMinimum ?? 5000,
      },
      autoPaySubscription: settings?.autoPaySubscription ?? false,
      openPayout: openPayout
        ? (openPayout.toJSON() as unknown as WalletSummary['openPayout'])
        : null,
      manualPayoutsLeftThisWeek:
        rules.manualPerWeek === null
          ? null
          : Math.max(
              0,
              rules.manualPerWeek -
                (await this.manualPayoutsThisWeek(organizationId)),
            ),
    };
  }

  listEntries(organizationId: string, page: number, limit: number) {
    const filter = { organizationId: new Types.ObjectId(organizationId) };
    return this.paginate(
      page,
      limit,
      (skip) =>
        this.entryModel
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .exec(),
      () => this.entryModel.countDocuments(filter).exec(),
    );
  }

  listPayouts(organizationId: string, page: number, limit: number) {
    const filter = { organizationId: new Types.ObjectId(organizationId) };
    return this.paginate(
      page,
      limit,
      (skip) =>
        this.payoutModel
          .find(filter)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .exec(),
      () => this.payoutModel.countDocuments(filter).exec(),
    );
  }

  private async paginate<T>(
    page: number,
    limit: number,
    find: (skip: number) => Promise<T[]>,
    count: () => Promise<number>,
  ) {
    const [data, total] = await Promise.all([
      find((page - 1) * limit),
      count(),
    ]);
    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /** Inserts one ledger line; a line already written for the same source is left alone. */
  private async addEntry(entry: {
    organizationId: string;
    kind: WalletEntryKind;
    amount: number;
    currency: string;
    availableAt: Date;
    sourceKey: string;
    paymentId?: Types.ObjectId;
    payoutId?: Types.ObjectId;
    note?: string;
  }): Promise<void> {
    try {
      await this.entryModel.create({
        ...entry,
        organizationId: new Types.ObjectId(entry.organizationId),
        amount: round2(entry.amount),
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }

  /* ─────────────────────────── sales ─────────────────────────── */

  /**
   * Credits a completed ONLINE payment — the only kind KORVA actually received. Cash and other
   * staff-recorded payments are in the business's till, not in KORVA's account. Idempotent: the
   * sweep calls it again for anything a crash or an outage left uncredited.
   */
  async creditFromPayment(
    organizationId: string,
    paymentId: string,
  ): Promise<void> {
    const payment = await this.paymentModel
      .findOne({
        _id: new Types.ObjectId(paymentId),
        organizationId: new Types.ObjectId(organizationId),
      })
      .lean()
      .exec();
    if (
      !payment ||
      payment.method !== 'online' ||
      payment.provider === 'manual' ||
      (payment.status !== 'completed' && payment.status !== 'refunded')
    ) {
      return;
    }
    if (await this.entryModel.exists({ sourceKey: `sale:${paymentId}` }))
      return;

    let costs: SaleCosts = { conversion: 0 };
    if (payment.providerReference) {
      try {
        const provider = await this.providerResolver.resolve({
          flow: 'commerce',
          organizationId,
        });
        costs = saleCostsInSaleCurrency(
          payment,
          await provider.verifyPayment(payment.providerReference),
        );
      } catch (error) {
        this.logger.warn(
          `Wallet: could not read the provider fee of payment ${paymentId} (${error instanceof Error ? error.message : String(error)})`,
        );
      }
    }
    const t = await this.translatorFor(organizationId);
    let fee = costs.fee;
    let feeNote: string | undefined;
    if (fee === undefined) {
      const fallbackBps = Number(
        this.configService.get<string>('WALLET_FALLBACK_FEE_BPS') ?? 300,
      );
      fee = round2((payment.amount * fallbackBps) / 10_000);
      feeNote = t(
        'Frais estimés : GeniusPay ne les a pas indiqués pour ce paiement.',
        'Estimated fee: GeniusPay did not report it for this payment.',
      );
    } else if (costs.detail?.providerFee !== undefined) {
      const { providerFee, providerCurrency } = costs.detail;
      feeNote = t(
        `${round2(providerFee)} ${providerCurrency} retenus par GeniusPay`,
        `${round2(providerFee)} ${providerCurrency} kept by GeniusPay`,
      );
    }
    const plan = await this.planOf(organizationId);
    const commission = round2(
      (payment.amount * PLAN_COMMISSION_BASIS_POINTS[plan]) / 10_000,
    );
    const availableAt = new Date(Date.now() + this.holdDays() * DAY_MS);
    const base = {
      organizationId,
      currency: payment.currency,
      availableAt,
      paymentId: payment._id,
    };
    // Fee and commission first: if the process dies in between, the sweep adds the sale later,
    // and the business is never shown money it does not have.
    if (fee > 0) {
      await this.addEntry({
        ...base,
        kind: 'provider_fee',
        amount: -fee,
        sourceKey: `fee:${paymentId}`,
        note: feeNote,
      });
    }
    if (costs.conversion > 0 && costs.detail) {
      await this.addEntry({
        ...base,
        kind: 'conversion_fee',
        amount: -costs.conversion,
        sourceKey: `conversion:${paymentId}`,
        note: t(
          `GeniusPay a encaissé ${round2(costs.detail.providerAmount)} ${costs.detail.providerCurrency} pour ${payment.amount} ${payment.currency}`,
          `GeniusPay collected ${round2(costs.detail.providerAmount)} ${costs.detail.providerCurrency} for ${payment.amount} ${payment.currency}`,
        ),
      });
    }
    if (commission > 0) {
      await this.addEntry({
        ...base,
        kind: 'commission',
        amount: -commission,
        sourceKey: `commission:${paymentId}`,
        note: `${PLAN_COMMISSION_BASIS_POINTS[plan] / 100} % (formule ${plan})`,
      });
    }
    await this.addEntry({
      ...base,
      kind: 'sale',
      amount: payment.amount,
      sourceKey: `sale:${paymentId}`,
    });
    // The cashier already sees a counter payment arrive on the till screen: only payments made
    // away from the business (its site) are worth an e-mail.
    if (!payment.idempotencyKey?.startsWith('counter:')) {
      void this.businessAlerts.notify(organizationId, {
        kind: 'online_payment',
        amount: payment.amount,
        currency: payment.currency,
      });
    }
  }

  /* ─────────────────────────── withdrawal number ─────────────────────────── */

  private settings(organizationId: string) {
    return this.settingsModel
      .findOne({ organizationId: new Types.ObjectId(organizationId) })
      .exec();
  }

  private codeHash(organizationId: string, code: string): string {
    return createHash('sha256')
      .update(`${organizationId}:${code}`)
      .digest('hex');
  }

  /** Records the new number as PENDING and e-mails a 6-digit code to whoever entered it. */
  async setDestination(
    organizationId: string,
    userEmail: string,
    input: SetPayoutDestinationInput,
  ): Promise<{ pending: true }> {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.settingsModel
      .updateOne(
        { organizationId: new Types.ObjectId(organizationId) },
        {
          $set: {
            pendingDestination: {
              ...input,
              codeHash: this.codeHash(organizationId, code),
              expiresAt: new Date(Date.now() + CODE_TTL_MS),
              attempts: 0,
            },
          },
        },
        { upsert: true },
      )
      .exec();
    const organization =
      await this.organizationsService.getById(organizationId);
    // In the business's language (shared/i18n.ts).
    const t = translator(organization.language);
    await this.emailProvider.send({
      to: userEmail,
      subject: t(
        `Code de confirmation de votre numéro de retrait — ${organization.name}`,
        `Confirmation code for your withdrawal number — ${organization.name}`,
      ),
      body: t(
        `<p>Code de confirmation : <strong style="font-size:20px;letter-spacing:3px">${code}</strong></p>` +
          `<p>Il confirme que les retraits de ${escapeHtml(organization.name)} iront vers ` +
          `${escapeHtml(input.account)} (${escapeHtml(input.holderName)}). Il expire dans 15 minutes.</p>` +
          `<p>Si vous n'êtes pas à l'origine de ce changement, ne communiquez ce code à personne et changez votre mot de passe.</p>`,
        `<p>Confirmation code: <strong style="font-size:20px;letter-spacing:3px">${code}</strong></p>` +
          `<p>It confirms that withdrawals for ${escapeHtml(organization.name)} will go to ` +
          `${escapeHtml(input.account)} (${escapeHtml(input.holderName)}). It expires in 15 minutes.</p>` +
          `<p>If you did not make this change, do not share this code with anyone and change your password.</p>`,
      ),
    });
    return { pending: true };
  }

  async confirmDestination(
    organizationId: string,
    code: string,
  ): Promise<void> {
    const settings = await this.settings(organizationId);
    const pending = settings?.pendingDestination;
    if (!pending || pending.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException({
        code: 'PAYOUT_CODE_EXPIRED',
        message:
          'No pending withdrawal number, or its code expired — enter it again',
      });
    }
    if (pending.attempts >= MAX_CODE_ATTEMPTS) {
      throw new BadRequestException({
        code: 'PAYOUT_CODE_LOCKED',
        message:
          'Too many wrong codes — enter the number again to receive a new code',
      });
    }
    const expected = Buffer.from(pending.codeHash);
    const given = Buffer.from(this.codeHash(organizationId, code));
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      await this.settingsModel
        .updateOne(
          { _id: settings._id },
          { $inc: { 'pendingDestination.attempts': 1 } },
        )
        .exec();
      throw new BadRequestException({
        code: 'PAYOUT_CODE_INVALID',
        message: 'Wrong code',
      });
    }
    await this.settingsModel
      .updateOne(
        { _id: settings._id },
        {
          $set: {
            destination: {
              provider: pending.provider,
              account: pending.account,
              holderName: pending.holderName,
            },
            destinationConfirmedAt: new Date(),
          },
          $unset: { pendingDestination: 1 },
        },
      )
      .exec();
  }

  async updateAutoPayout(
    organizationId: string,
    input: UpdateAutoPayoutInput,
  ): Promise<void> {
    const plan = await this.planOf(organizationId);
    if (
      input.frequency === 'daily' &&
      !PLAN_PAYOUT_RULES[plan].dailyAutoPayout
    ) {
      throw new ForbiddenException({
        code: 'PAYOUT_DAILY_NOT_IN_PLAN',
        message:
          'Daily automatic withdrawals come with the Pro and Business plans',
      });
    }
    await this.settingsModel
      .updateOne(
        { organizationId: new Types.ObjectId(organizationId) },
        {
          $set: {
            autoPayoutEnabled: input.enabled,
            autoPayoutFrequency: input.frequency,
            autoPayoutMinimum: input.minimum,
          },
        },
        { upsert: true },
      )
      .exec();
  }

  /* ─────────────────────────── KORVA plan ─────────────────────────── */

  async updateSubscriptionAutopay(
    organizationId: string,
    enabled: boolean,
  ): Promise<void> {
    await this.settingsModel
      .updateOne(
        { organizationId: new Types.ObjectId(organizationId) },
        { $set: { autoPaySubscription: enabled } },
        { upsert: true },
      )
      .exec();
  }

  async subscriptionAutopayEnabled(organizationId: string): Promise<boolean> {
    return (await this.settings(organizationId))?.autoPaySubscription ?? false;
  }

  /**
   * Takes a KORVA plan invoice's amount off the balance and returns the ledger line's id. The
   * caller settles the invoice and gives the amount back (refundSubscriptionDebit) if the invoice
   * turned out already paid. Each attempt has its own sourceKey: the invoice's status:'open'
   * guard — not this line — is what makes paying twice impossible. A concurrent withdrawal that
   * left the balance below zero is caught right after writing, and the line is given back.
   */
  async debitForSubscription(
    organizationId: string,
    invoice: { id: string; number: string; amount: number; currency: string },
  ): Promise<string> {
    const organization =
      await this.organizationsService.getById(organizationId);
    if (organization.currency !== invoice.currency) {
      throw new UnprocessableEntityException({
        code: 'WALLET_CURRENCY_MISMATCH',
        message: `This invoice is in ${invoice.currency} and your balance in ${organization.currency}`,
      });
    }
    const insufficient = (available: number) =>
      new UnprocessableEntityException({
        code: 'WALLET_INSUFFICIENT_BALANCE',
        message: 'Your available balance does not cover this invoice',
        details: { available, amount: invoice.amount },
      });
    const before = await this.balances(organizationId);
    if (before.available < invoice.amount) throw insufficient(before.available);

    const entryId = new Types.ObjectId();
    await this.entryModel.create({
      _id: entryId,
      organizationId: new Types.ObjectId(organizationId),
      kind: 'subscription',
      amount: -round2(invoice.amount),
      currency: invoice.currency,
      availableAt: new Date(),
      sourceKey: `subscription:${invoice.id}:${entryId.toString()}`,
      note: `Facture ${invoice.number}`,
    });

    const after = await this.balances(organizationId);
    if (after.available < 0) {
      await this.refundSubscriptionDebit(organizationId, entryId.toString());
      throw insufficient(round2(after.available + invoice.amount));
    }
    return entryId.toString();
  }

  /** Gives a subscription debit back, once. */
  async refundSubscriptionDebit(
    organizationId: string,
    entryId: string,
    note?: string,
  ): Promise<void> {
    const entry = await this.entryModel
      .findOne({
        _id: new Types.ObjectId(entryId),
        organizationId: new Types.ObjectId(organizationId),
        kind: 'subscription',
      })
      .lean()
      .exec();
    if (!entry) return;
    const t = await this.translatorFor(organizationId);
    await this.addEntry({
      organizationId,
      kind: 'subscription_reversal',
      amount: -entry.amount,
      currency: entry.currency,
      availableAt: new Date(),
      sourceKey: `subscription-reversal:${entryId}`,
      note: note ?? t('Montant rendu', 'Amount returned'),
    });
  }

  /**
   * An invoice paid from the balance whose old GeniusPay link was ALSO paid afterwards: KORVA
   * received the money twice, so the balance gets its debit back. Called when GeniusPay reports
   * that payment, on an invoice that is no longer open.
   */
  async refundSubscriptionPaidTwice(
    organizationId: string,
    invoiceId: string,
  ): Promise<boolean> {
    const debits = await this.entryModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        kind: 'subscription',
        sourceKey: { $regex: `^subscription:${invoiceId}:` },
      })
      .lean()
      .exec();
    for (const debit of debits) {
      const id = debit._id.toString();
      const reversed = await this.entryModel
        .exists({ sourceKey: `subscription-reversal:${id}` })
        .exec();
      if (!reversed) {
        await this.refundSubscriptionDebit(
          organizationId,
          id,
          (await this.translatorFor(organizationId))(
            'Facture aussi payée par GeniusPay — montant rendu',
            'Invoice also paid through GeniusPay — amount returned',
          ),
        );
        return true;
      }
    }
    return false;
  }

  /* ─────────────────────────── withdrawals ─────────────────────────── */

  private async manualPayoutsThisWeek(organizationId: string): Promise<number> {
    return this.payoutModel
      .countDocuments({
        organizationId: new Types.ObjectId(organizationId),
        trigger: 'manual',
        status: { $ne: 'rejected' },
        createdAt: { $gte: new Date(Date.now() - 7 * DAY_MS) },
      })
      .exec();
  }

  async requestPayout(
    organizationId: string,
    input: RequestPayoutInput,
    trigger: 'manual' | 'auto',
    userId?: string,
  ): Promise<PayoutDocument> {
    const [settings, plan, organization] = await Promise.all([
      this.settings(organizationId),
      this.planOf(organizationId),
      this.organizationsService.getById(organizationId),
    ]);
    const destination = settings?.destination;
    if (!destination) {
      throw new BadRequestException({
        code: 'PAYOUT_DESTINATION_MISSING',
        message: 'Add and confirm a withdrawal number first',
      });
    }
    const rules = PLAN_PAYOUT_RULES[plan];
    if (
      trigger === 'manual' &&
      rules.manualPerWeek !== null &&
      (await this.manualPayoutsThisWeek(organizationId)) >= rules.manualPerWeek
    ) {
      throw new ForbiddenException({
        code: 'PAYOUT_WEEKLY_LIMIT',
        message: `Your plan allows ${rules.manualPerWeek} withdrawal request(s) per 7 days — switch on automatic withdrawals, or move to Pro for unlimited requests`,
      });
    }
    const { available } = await this.balances(organizationId);
    const amount = Math.floor(input.amount ?? available);
    if (amount < MIN_PAYOUT_AMOUNT) {
      throw new BadRequestException({
        code: 'PAYOUT_BELOW_MINIMUM',
        message: `The minimum withdrawal is ${MIN_PAYOUT_AMOUNT}`,
        details: { minimum: MIN_PAYOUT_AMOUNT, available },
      });
    }
    if (amount > available) {
      throw new BadRequestException({
        code: 'PAYOUT_EXCEEDS_BALANCE',
        message: 'This amount is more than your available balance',
        details: { available },
      });
    }

    let payout: PayoutDocument;
    try {
      payout = await this.payoutModel.create({
        organizationId: new Types.ObjectId(organizationId),
        amount,
        currency: organization.currency,
        status: 'requested',
        open: true,
        trigger,
        destination: {
          provider: destination.provider,
          account: destination.account,
          holderName: destination.holderName,
        },
        ...(userId ? { requestedBy: new Types.ObjectId(userId) } : {}),
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new ConflictException({
          code: 'PAYOUT_ALREADY_OPEN',
          message: 'A withdrawal is already on its way — wait for it to finish',
        });
      }
      throw error;
    }
    await this.addEntry({
      organizationId,
      kind: 'payout',
      amount: -amount,
      currency: organization.currency,
      availableAt: new Date(),
      sourceKey: `payout:${payout.id as string}`,
      payoutId: payout._id,
    });

    if (this.approvalMode() === 'auto') await this.send(payout.id as string);
    return (await this.payoutModel.findById(payout._id).exec())!;
  }

  /** Sends a requested withdrawal (or re-sends one that never got an answer). */
  async send(payoutId: string): Promise<PayoutDocument | null> {
    const payout = await this.payoutModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(payoutId),
          $or: [
            { status: 'requested' },
            { status: 'processing', providerReference: { $exists: false } },
          ],
        },
        { $set: { status: 'processing', approvedAt: new Date() } },
        { new: true },
      )
      .exec();
    if (!payout) return null;
    const organizationId = payout.organizationId.toString();
    try {
      const provider = await this.providerResolver.resolve({
        flow: 'commerce',
        organizationId,
      });
      if (!provider.createPayout) {
        await this.fail(
          payout,
          `${provider.name} cannot send withdrawals`,
          'failed',
        );
        return this.payoutModel.findById(payout._id).exec();
      }
      const organization =
        await this.organizationsService.getById(organizationId);
      const result = await provider.createPayout({
        amount: payout.amount,
        currency: payout.currency,
        reference: payoutId,
        destination: payout.destination,
        description: `Reversement KORVA — ${organization.name}`,
      });
      await this.payoutModel
        .updateOne(
          { _id: payout._id },
          {
            $set: {
              providerReference: result.providerReference,
              ...(result.fee !== undefined ? { fee: result.fee } : {}),
            },
          },
        )
        .exec();
      await this.applyResult(payout._id, result);
    } catch (error) {
      if (isAmbiguousProviderError(error)) {
        // No answer: GeniusPay may have paid. Left "processing" without a reference; the sweep
        // re-sends with the same idempotency key, which cannot pay twice.
        this.logger.warn(
          `Payout ${payoutId}: no answer from the provider, will retry`,
        );
      } else {
        await this.fail(
          payout,
          error instanceof Error ? error.message : String(error),
          'failed',
        );
      }
    }
    return this.payoutModel.findById(payout._id).exec();
  }

  private async applyResult(
    payoutId: Types.ObjectId,
    result: { status: string; fee?: number; failureReason?: string },
  ): Promise<void> {
    const payout = await this.payoutModel.findById(payoutId).exec();
    if (!payout) return;
    if (result.status === 'completed') await this.complete(payout, result.fee);
    if (result.status === 'failed') {
      await this.fail(
        payout,
        result.failureReason ??
          (await this.translatorFor(payout.organizationId.toString()))(
            'Refusé par GeniusPay',
            'Refused by GeniusPay',
          ),
        'failed',
      );
    }
  }

  private async complete(payout: PayoutDocument, fee?: number): Promise<void> {
    const done = await this.payoutModel
      .findOneAndUpdate(
        { _id: payout._id, status: 'processing' },
        {
          $set: {
            status: 'completed',
            completedAt: new Date(),
            ...(fee !== undefined ? { fee } : {}),
          },
          $unset: { open: 1 },
        },
        { new: true },
      )
      .exec();
    if (!done) return;
    const organizationId = done.organizationId.toString();
    const finalFee = done.fee ?? 0;
    if (finalFee > 0) {
      const plan = await this.planOf(organizationId);
      if (!PLAN_PAYOUT_RULES[plan].payoutFeeIncluded) {
        await this.addEntry({
          organizationId,
          kind: 'payout_fee',
          amount: -finalFee,
          currency: done.currency,
          availableAt: new Date(),
          sourceKey: `payout_fee:${done.id as string}`,
          payoutId: done._id,
        });
      }
    }
  }

  private async fail(
    payout: PayoutDocument,
    reason: string,
    status: 'failed' | 'rejected',
  ): Promise<boolean> {
    const closed = await this.payoutModel
      .findOneAndUpdate(
        {
          _id: payout._id,
          status: {
            $in:
              status === 'rejected'
                ? ['requested']
                : ['requested', 'processing'],
          },
        },
        {
          $set: { status, failureReason: reason.slice(0, 300) },
          $unset: { open: 1 },
        },
        { new: true },
      )
      .exec();
    if (!closed) return false;
    await this.addEntry({
      organizationId: closed.organizationId.toString(),
      kind: 'payout_reversal',
      amount: closed.amount,
      currency: closed.currency,
      availableAt: new Date(),
      sourceKey: `payout_reversal:${closed.id as string}`,
      payoutId: closed._id,
    });
    return true;
  }

  /** Asks GeniusPay where a sent withdrawal stands (webhook, sweep, or the admin's refresh). */
  async syncPayout(payoutId: string): Promise<void> {
    const payout = await this.payoutModel.findById(payoutId).exec();
    if (!payout || payout.status !== 'processing') return;
    if (!payout.providerReference) {
      if (
        Date.now() - (payout.get('updatedAt') as Date).getTime() >
        RESEND_AFTER_MS
      ) {
        await this.send(payoutId);
      }
      return;
    }
    // Paid by hand (markPaidManually) and interrupted before it closed: GeniusPay knows nothing
    // of it — finish closing it with what the administration recorded.
    if (payout.providerReference.startsWith('manual:')) {
      await this.complete(payout);
      return;
    }
    const provider = await this.providerResolver.resolve({
      flow: 'commerce',
      organizationId: payout.organizationId.toString(),
    });
    if (!provider.getPayout) return;
    const result = await provider.getPayout(payout.providerReference);
    if (result.fee !== undefined) {
      await this.payoutModel
        .updateOne({ _id: payout._id }, { $set: { fee: result.fee } })
        .exec();
    }
    await this.applyResult(payout._id, result);
  }

  async syncPayoutByReference(providerReference: string): Promise<boolean> {
    const payout = await this.payoutModel.findOne({ providerReference }).exec();
    if (!payout) return false;
    await this.syncPayout(payout.id as string);
    return true;
  }

  /* ─────────────────────────── administration ─────────────────────────── */

  async approve(payoutId: string): Promise<PayoutDocument> {
    const sent = await this.send(payoutId);
    if (!sent) {
      throw new BadRequestException({
        code: 'PAYOUT_NOT_APPROVABLE',
        message: 'Only a requested withdrawal can be approved',
      });
    }
    return sent;
  }

  /**
   * The administration paid a requested withdrawal by hand — from KORVA's own Wave or Orange Money,
   * or GeniusPay's dashboard — and records it: the withdrawal closes as paid, with the operator's
   * reference and the real fee (passed on as for any withdrawal, except on Business). This is how
   * businesses get paid while GeniusPay has not opened its payout API to KORVA. The reference
   * is stored as "manual:…", so nothing ever asks GeniusPay about it, and a withdrawal being sent
   * through GeniusPay at the same moment cannot also be marked: only a "requested" one can.
   */
  async markPaidManually(
    payoutId: string,
    reference: string,
    fee?: number,
  ): Promise<PayoutDocument> {
    const claimed = await this.payoutModel
      .findOneAndUpdate(
        { _id: new Types.ObjectId(payoutId), status: 'requested' },
        {
          $set: {
            status: 'processing',
            approvedAt: new Date(),
            providerReference: `manual:${reference}`,
            ...(fee !== undefined ? { fee } : {}),
          },
        },
        { new: true },
      )
      .exec();
    if (!claimed) {
      throw new BadRequestException({
        code: 'PAYOUT_NOT_APPROVABLE',
        message: 'Only a requested withdrawal can be marked as paid',
      });
    }
    await this.complete(claimed, fee);
    return (await this.payoutModel.findById(claimed._id).exec())!;
  }

  async reject(payoutId: string, reason: string): Promise<void> {
    const payout = await this.payoutModel.findById(payoutId).exec();
    if (!payout) {
      throw new NotFoundException({
        code: 'PAYOUT_NOT_FOUND',
        message: 'Payout not found',
      });
    }
    if (!(await this.fail(payout, reason, 'rejected'))) {
      throw new BadRequestException({
        code: 'PAYOUT_NOT_REJECTABLE',
        message: 'Only a requested withdrawal can be refused',
      });
    }
  }

  async adjust(
    organizationId: string,
    amount: number,
    note: string,
  ): Promise<void> {
    const organization =
      await this.organizationsService.getById(organizationId);
    await this.addEntry({
      organizationId,
      kind: 'adjustment',
      amount,
      currency: organization.currency,
      availableAt: new Date(),
      sourceKey: `adjustment:${new Types.ObjectId().toString()}`,
      note,
    });
  }

  async adminPayouts(
    status?: string,
  ): Promise<(PayoutView & { organizationName: string })[]> {
    const payouts = await this.payoutModel
      .find(status ? { status } : {})
      .sort({ createdAt: -1 })
      .limit(300)
      .exec();
    const names = new Map<string, string>();
    for (const id of new Set(payouts.map((p) => p.organizationId.toString()))) {
      const organization = await this.organizationsService
        .getById(id)
        .catch(() => null);
      if (organization) names.set(id, organization.name);
    }
    // Dates stay Date objects here; the HTTP layer serializes them to the ISO strings the type
    // describes.
    return payouts.map(
      (payout) =>
        ({
          ...payout.toJSON(),
          organizationName: names.get(payout.organizationId.toString()) ?? '—',
        }) as unknown as PayoutView & { organizationName: string },
    );
  }

  async overview(): Promise<PlatformWalletOverview> {
    const now = new Date();
    const monthStart = new Date(
      `${now.toISOString().slice(0, 7)}-01T00:00:00.000Z`,
    );
    const [[held], [commission], toApprove, processing] = await Promise.all([
      this.entryModel
        .aggregate<{ available: number; pending: number }>([
          {
            $group: {
              _id: null,
              available: {
                $sum: {
                  $cond: [{ $lte: ['$availableAt', now] }, '$amount', 0],
                },
              },
              pending: {
                $sum: { $cond: [{ $gt: ['$availableAt', now] }, '$amount', 0] },
              },
            },
          },
        ])
        .exec(),
      this.entryModel
        .aggregate<{ total: number }>([
          { $match: { kind: 'commission', createdAt: { $gte: monthStart } } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ])
        .exec(),
      this.payoutModel.countDocuments({ status: 'requested' }).exec(),
      this.payoutModel.countDocuments({ status: 'processing' }).exec(),
    ]);
    return {
      currency: 'XOF',
      heldAvailable: round2(held?.available ?? 0),
      heldPending: round2(held?.pending ?? 0),
      commissionThisMonth: round2(-(commission?.total ?? 0)),
      payoutsToApprove: toApprove,
      payoutsProcessing: processing,
      approvalMode: this.approvalMode(),
    };
  }

  /* ─────────────────────────── sweep ─────────────────────────── */

  /** Every reconciliation run: credit what was missed, follow sent withdrawals, run automatic ones. */
  async runSweep(): Promise<{
    credited: number;
    synced: number;
    automatic: number;
  }> {
    let credited = 0;
    let synced = 0;
    let automatic = 0;

    const since = new Date(Date.now() - 30 * DAY_MS);
    const payments = await this.paymentModel
      .find(
        {
          method: 'online',
          provider: { $ne: 'manual' },
          status: { $in: ['completed', 'refunded'] },
          updatedAt: { $gte: since },
        },
        { _id: 1, organizationId: 1 },
      )
      .limit(500)
      .lean()
      .exec();
    if (payments.length > 0) {
      const done = new Set(
        (
          await this.entryModel
            .find(
              {
                sourceKey: {
                  $in: payments.map((p) => `sale:${String(p._id)}`),
                },
              },
              { sourceKey: 1 },
            )
            .lean()
            .exec()
        ).map((entry) => entry.sourceKey),
      );
      for (const payment of payments) {
        if (done.has(`sale:${String(payment._id)}`)) continue;
        try {
          await this.creditFromPayment(
            String(payment.organizationId),
            String(payment._id),
          );
          credited += 1;
        } catch (error) {
          this.logger.error(
            `Wallet sweep: credit failed for payment ${String(payment._id)}`,
            error,
          );
        }
      }
    }

    for (const payout of await this.payoutModel
      .find({ status: 'processing' })
      .limit(50)
      .exec()) {
      try {
        await this.syncPayout(payout.id as string);
        synced += 1;
      } catch (error) {
        this.logger.error(
          `Wallet sweep: payout ${payout.id as string} not synced`,
          error,
        );
      }
    }

    const due = await this.settingsModel
      .find({ autoPayoutEnabled: true })
      .limit(500)
      .exec();
    for (const settings of due) {
      const organizationId = settings.organizationId.toString();
      try {
        if (!settings.destination || !settings.destinationConfirmedAt) continue;
        if (
          Date.now() - settings.destinationConfirmedAt.getTime() <
          DESTINATION_COOLDOWN_MS
        ) {
          continue;
        }
        const plan = await this.planOf(organizationId);
        const daily =
          settings.autoPayoutFrequency === 'daily' &&
          PLAN_PAYOUT_RULES[plan].dailyAutoPayout;
        const period = (daily ? 1 : 7) * DAY_MS;
        if (
          settings.lastAutoPayoutAt &&
          Date.now() - settings.lastAutoPayoutAt.getTime() < period
        ) {
          continue;
        }
        const { available } = await this.balances(organizationId);
        if (available < Math.max(settings.autoPayoutMinimum, MIN_PAYOUT_AMOUNT))
          continue;
        if (
          await this.payoutModel.exists({
            organizationId: settings.organizationId,
            open: true,
          })
        ) {
          continue;
        }
        await this.requestPayout(organizationId, {}, 'auto');
        await this.settingsModel
          .updateOne(
            { _id: settings._id },
            { $set: { lastAutoPayoutAt: new Date() } },
          )
          .exec();
        automatic += 1;
      } catch (error) {
        this.logger.error(
          `Wallet sweep: automatic withdrawal failed for ${organizationId}`,
          error,
        );
      }
    }
    return { credited, synced, automatic };
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
