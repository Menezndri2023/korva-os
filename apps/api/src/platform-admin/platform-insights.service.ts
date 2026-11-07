import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { IntegrationsService } from '../integrations/integrations.service';
import { WalletService } from '../finance/wallet/wallet.service';
import {
  PlatformNote,
  type PlatformNoteDocument,
} from './schemas/platform-note.schema';

const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (value: number) => Math.round(value * 100) / 100;

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface OpenInvoiceRow {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  number: string;
  amount: number;
  currency: string;
  dueAt: Date;
  periodStart: Date;
  kind?: 'renewal' | 'plan_change';
}

/**
 * What the administration needs beyond the per-section lists of PlatformAdminService: what is
 * waiting for an action, KORVA's own money (plans, commissions, money held for the businesses),
 * one search across everything, internal notes on a business, and the state of the payment
 * accounts. Read-only except for adding a note.
 */
@Injectable()
export class PlatformInsightsService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(PlatformNote.name)
    private readonly noteModel: Model<PlatformNoteDocument>,
    private readonly walletService: WalletService,
    private readonly integrationsService: IntegrationsService,
  ) {}

  private collection(name: string) {
    return this.connection.collection(name);
  }

  /** The counters behind "À traiter aujourd'hui" and the menu badges. */
  async todo(now: Date = new Date()) {
    const [payoutsToApprove, overdueInvoices, reviewsToModerate, pastDue] =
      await Promise.all([
        this.collection('payouts').countDocuments({ status: 'requested' }),
        this.collection('subscription_invoices').countDocuments({
          status: 'open',
          kind: { $ne: 'plan_change' },
          dueAt: { $lt: now },
        }),
        this.collection('platform_reviews').countDocuments({
          status: 'pending',
        }),
        this.collection('subscriptions').countDocuments({ status: 'past_due' }),
      ]);
    return {
      payoutsToApprove,
      overdueInvoices,
      reviewsToModerate,
      pastDueSubscriptions: pastDue,
    };
  }

  /**
   * KORVA's money over the last `days` days: plan invoices paid (per currency), online sales the
   * businesses made through KORVA and what KORVA kept on them, withdrawals paid out, and the open
   * plan invoices to chase — a plan change waiting to be paid is not chased, so it is left out.
   */
  async finance(days: number, now: Date = new Date()) {
    const since = new Date(now.getTime() - days * DAY_MS);
    const [plansPaid, ledger, payoutsPaid, wallet, openRows] =
      await Promise.all([
        this.collection('subscription_invoices')
          .aggregate<{ _id: string; total: number; count: number }>([
            { $match: { status: 'paid', paidAt: { $gte: since } } },
            {
              $group: {
                _id: '$currency',
                total: { $sum: '$amount' },
                count: { $sum: 1 },
              },
            },
          ])
          .toArray(),
        this.collection('wallet_entries')
          .aggregate<{ _id: string; total: number; count: number }>([
            {
              $match: {
                createdAt: { $gte: since },
                kind: {
                  $in: ['sale', 'commission', 'provider_fee', 'conversion_fee'],
                },
              },
            },
            {
              $group: {
                _id: '$kind',
                total: { $sum: '$amount' },
                count: { $sum: 1 },
              },
            },
          ])
          .toArray(),
        this.collection('payouts')
          .aggregate<{ total: number; fees: number; count: number }>([
            { $match: { status: 'completed', completedAt: { $gte: since } } },
            {
              $group: {
                _id: null,
                total: { $sum: '$amount' },
                fees: { $sum: { $ifNull: ['$fee', 0] } },
                count: { $sum: 1 },
              },
            },
          ])
          .toArray(),
        this.walletService.overview(),
        this.collection('subscription_invoices')
          .find({ status: 'open', kind: { $ne: 'plan_change' } })
          .sort({ dueAt: 1 })
          .limit(100)
          .toArray()
          .then((rows) => rows as unknown as OpenInvoiceRow[]),
      ]);

    const byKind = new Map(ledger.map((row) => [row._id, row]));
    const names = await this.organizationNames(
      openRows.map((row) => row.organizationId),
    );

    return {
      periodDays: days,
      plansPaid: plansPaid
        .map((row) => ({
          currency: row._id,
          total: round2(row.total),
          count: row.count,
        }))
        .sort((a, b) => b.total - a.total),
      onlineSales: {
        currency: wallet.currency,
        total: round2(byKind.get('sale')?.total ?? 0),
        count: byKind.get('sale')?.count ?? 0,
        commissions: round2(-(byKind.get('commission')?.total ?? 0)),
        // A currency conversion is GeniusPay's too: what it kept on the sale either way.
        providerFees: round2(
          -(
            (byKind.get('provider_fee')?.total ?? 0) +
            (byKind.get('conversion_fee')?.total ?? 0)
          ),
        ),
      },
      payoutsPaid: {
        total: round2(payoutsPaid[0]?.total ?? 0),
        fees: round2(payoutsPaid[0]?.fees ?? 0),
        count: payoutsPaid[0]?.count ?? 0,
      },
      held: {
        currency: wallet.currency,
        available: wallet.heldAvailable,
        pending: wallet.heldPending,
      },
      openInvoices: openRows.map((row) => ({
        id: row._id.toString(),
        organizationId: row.organizationId.toString(),
        organizationName: names.get(row.organizationId.toString()) ?? '—',
        number: row.number,
        amount: row.amount,
        currency: row.currency,
        dueAt: row.dueAt,
        overdue: row.dueAt < now,
      })),
    };
  }

  /** One box for the whole administration: businesses, people and plan invoices. */
  async search(rawQuery: string) {
    const q = rawQuery.trim();
    if (q.length < 2) return { organizations: [], users: [], invoices: [] };
    const pattern = { $regex: escapeRegex(q), $options: 'i' };
    const [organizations, users, invoices] = await Promise.all([
      this.collection('organizations')
        .find(
          {
            $or: [
              { name: pattern },
              { slug: pattern },
              { customDomain: pattern },
            ],
          },
          { projection: { name: 1, slug: 1, businessModel: 1 } },
        )
        .limit(8)
        .toArray(),
      this.collection('users')
        .find(
          {
            $or: [
              { email: pattern },
              { firstName: pattern },
              { lastName: pattern },
            ],
          },
          { projection: { email: 1, firstName: 1, lastName: 1 } },
        )
        .limit(8)
        .toArray(),
      this.collection('subscription_invoices')
        .find(
          { number: pattern },
          { projection: { number: 1, organizationId: 1, status: 1 } },
        )
        .limit(8)
        .toArray(),
    ]);
    const names = await this.organizationNames(
      invoices.map((invoice) => invoice.organizationId as Types.ObjectId),
    );
    return {
      organizations: organizations.map((org) => ({
        id: org._id.toString(),
        name: org.name as string,
        slug: org.slug as string,
      })),
      users: users.map((user) => ({
        id: user._id.toString(),
        email: user.email as string,
        name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
      })),
      invoices: invoices.map((invoice) => ({
        id: invoice._id.toString(),
        number: invoice.number as string,
        status: invoice.status as string,
        organizationId: String(invoice.organizationId),
        organizationName: names.get(String(invoice.organizationId)) ?? '—',
      })),
    };
  }

  async notes(organizationId: string) {
    const id = this.organizationObjectId(organizationId);
    const rows = await this.noteModel
      .find({ organizationId: id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean()
      .exec();
    return rows.map((row) => ({
      id: row._id.toString(),
      text: row.text,
      authorEmail: row.authorEmail,
      createdAt: (row as unknown as { createdAt: Date }).createdAt,
    }));
  }

  async addNote(organizationId: string, authorEmail: string, text: string) {
    const id = this.organizationObjectId(organizationId);
    if (
      !(await this.collection('organizations').countDocuments(
        { _id: id },
        { limit: 1 },
      ))
    ) {
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found',
      });
    }
    const note = await this.noteModel.create({
      organizationId: id,
      text,
      authorEmail,
    });
    return {
      id: note.id as string,
      text: note.text,
      authorEmail: note.authorEmail,
      createdAt: (note as unknown as { createdAt: Date }).createdAt,
    };
  }

  /**
   * KORVA's own payment accounts (never a secret): which are active, when GeniusPay last
   * confirmed one, its last error, and when its last webhook arrived — a silent webhook means
   * payments are only confirmed by the reconciliation sweep, minutes later.
   */
  async paymentAccounts(now: Date = new Date()) {
    const [accounts, lastWebhooks] = await Promise.all([
      this.integrationsService.listPlatformAccounts('payment'),
      this.collection('integration_webhook_events')
        .aggregate<{ _id: string; lastAt: Date; last24h: number }>([
          { $match: { domain: 'payment' } },
          {
            $group: {
              _id: '$provider',
              lastAt: { $max: '$receivedAt' },
              last24h: {
                $sum: {
                  $cond: [
                    { $gte: ['$receivedAt', new Date(now.getTime() - DAY_MS)] },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ])
        .toArray(),
    ]);
    const webhookByProvider = new Map(
      lastWebhooks.map((row) => [row._id, row]),
    );
    return {
      payoutApproval: (await this.walletService.overview()).approvalMode,
      accounts: accounts.map((account) => ({
        id: account.id,
        provider: account.provider,
        role: account.role,
        market: account.market,
        status: account.status,
        lastVerifiedAt: account.lastVerifiedAt,
        lastErrorAt: account.lastErrorAt,
        lastErrorMessage: account.lastErrorMessage,
        lastWebhookAt: webhookByProvider.get(account.provider)?.lastAt ?? null,
        webhooksLast24h: webhookByProvider.get(account.provider)?.last24h ?? 0,
      })),
    };
  }

  private organizationObjectId(organizationId: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(organizationId)) {
      throw new NotFoundException({
        code: 'ORGANIZATION_NOT_FOUND',
        message: 'Organization not found',
      });
    }
    return new Types.ObjectId(organizationId);
  }

  private async organizationNames(
    ids: Types.ObjectId[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.collection('organizations')
      .find({ _id: { $in: ids } }, { projection: { name: 1 } })
      .toArray();
    return new Map(rows.map((row) => [row._id.toString(), row.name as string]));
  }
}
