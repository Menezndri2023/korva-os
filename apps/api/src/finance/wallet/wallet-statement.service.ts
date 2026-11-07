import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WALLET_ENTRY_KINDS,
  WALLET_ENTRY_LABELS,
  WALLET_ENTRY_LABELS_EN,
  type WalletEntryKind,
} from '@korva/types';
import {
  WalletEntry,
  type WalletEntryDocument,
} from './schemas/wallet-entry.schema';
import { Organization } from '../../organizations/schemas/organization.schema';
import { zonedTimeToUtc } from '../../booking/availability/availability.service';
import { intlLocaleOf, orgLocale, translator } from '../../shared/i18n';
import { toCsv } from '../../shared/csv';
import type { DocumentTemplate } from '../../documents/rendering/document-rendering.service';

export interface WalletStatement {
  month: string;
  currency: string;
  opening: number;
  closing: number;
  /** Month total per kind of line — sales positive, fees and withdrawals negative. */
  totals: {
    kind: WalletEntryKind;
    label: string;
    amount: number;
    count: number;
  }[];
  lines: {
    date: string;
    kind: WalletEntryKind;
    label: string;
    note: string;
    amount: number;
  }[];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** "2026-11" → "2026-12". */
function nextMonth(month: string): string {
  const [year, m] = month.split('-').map(Number) as [number, number];
  return m === 12
    ? `${year + 1}-01`
    : `${year}-${String(m + 1).padStart(2, '0')}`;
}

/**
 * Le relevé mensuel du Solde KORVA: what the accountant asks for, and what lets an owner check
 * every franc — opening balance, the month's sales, GeniusPay's fees, exchange, commission,
 * withdrawals, closing balance, then every line. A month is the organization's calendar month,
 * in its own timezone, and its lines are those created in it (a sale released later still
 * belongs to the month the customer paid).
 */
@Injectable()
export class WalletStatementService {
  constructor(
    @InjectModel(WalletEntry.name)
    private readonly entryModel: Model<WalletEntryDocument>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
  ) {}

  async build(
    organizationId: string,
    month: string,
  ): Promise<WalletStatement & { language?: string; name: string }> {
    const organization = await this.organizationModel
      .findById(organizationId, {
        name: 1,
        currency: 1,
        timezone: 1,
        language: 1,
      })
      .lean<{
        name: string;
        currency: string;
        timezone?: string;
        language?: string;
      }>()
      .exec();
    const timeZone = organization?.timezone ?? 'UTC';
    const start = zonedTimeToUtc(`${month}-01`, '00:00', timeZone);
    const end = zonedTimeToUtc(`${nextMonth(month)}-01`, '00:00', timeZone);
    const orgId = new Types.ObjectId(organizationId);
    const en = orgLocale(organization?.language) === 'en';
    const labels = en ? WALLET_ENTRY_LABELS_EN : WALLET_ENTRY_LABELS;
    const locale = intlLocaleOf(organization?.language);

    const [before] = await this.entryModel
      .aggregate<{ total: number }>([
        { $match: { organizationId: orgId, createdAt: { $lt: start } } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ])
      .exec();
    const entries = await this.entryModel
      .find({ organizationId: orgId, createdAt: { $gte: start, $lt: end } })
      .sort({ createdAt: 1 })
      .lean<(WalletEntry & { createdAt: Date })[]>()
      .exec();

    const opening = round2(before?.total ?? 0);
    const byKind = new Map<
      WalletEntryKind,
      { amount: number; count: number }
    >();
    for (const entry of entries) {
      const row = byKind.get(entry.kind) ?? { amount: 0, count: 0 };
      row.amount += entry.amount;
      row.count += 1;
      byKind.set(entry.kind, row);
    }
    const monthTotal = entries.reduce((sum, entry) => sum + entry.amount, 0);
    return {
      name: organization?.name ?? '',
      language: organization?.language,
      month,
      currency: organization?.currency ?? 'XOF',
      opening,
      closing: round2(opening + monthTotal),
      totals: WALLET_ENTRY_KINDS.filter((kind) => byKind.has(kind)).map(
        (kind) => ({
          kind,
          label: labels[kind],
          amount: round2(byKind.get(kind)!.amount),
          count: byKind.get(kind)!.count,
        }),
      ),
      lines: entries.map((entry) => ({
        date: entry.createdAt.toLocaleDateString(locale, { timeZone }),
        kind: entry.kind,
        label: labels[entry.kind],
        note: entry.note ?? '',
        amount: round2(entry.amount),
      })),
    };
  }

  toCsv(statement: WalletStatement & { language?: string }): string {
    const t = translator(statement.language);
    return toCsv(
      [
        t('Date', 'Date'),
        t('Mouvement', 'Movement'),
        t('Détail', 'Detail'),
        t(`Montant (${statement.currency})`, `Amount (${statement.currency})`),
      ],
      [
        [
          '',
          t('Solde au début du mois', 'Balance at the start of the month'),
          '',
          statement.opening,
        ],
        ...statement.lines.map((line) => [
          line.date,
          line.label,
          line.note,
          line.amount,
        ]),
        [
          '',
          t('Solde à la fin du mois', 'Balance at the end of the month'),
          '',
          statement.closing,
        ],
      ],
    );
  }

  toDocument(
    statement: WalletStatement & { language?: string; name: string },
  ): DocumentTemplate {
    const t = translator(statement.language);
    const locale = intlLocaleOf(statement.language);
    const money = (amount: number) =>
      new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: statement.currency,
      }).format(amount);
    const [year, month] = statement.month.split('-').map(Number) as [
      number,
      number,
    ];
    const period = new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString(
      locale,
      {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      },
    );
    return {
      documentType: 'statement',
      title: t(
        `Relevé du Solde KORVA — ${period}`,
        `KORVA balance statement — ${period}`,
      ),
      organizationHeader: { name: statement.name },
      metadata: [
        { label: t('Période', 'Period'), value: period },
        {
          label: t('Solde au début du mois', 'Opening balance'),
          value: money(statement.opening),
        },
        ...statement.totals.map((total) => ({
          label: `${total.label} (${total.count})`,
          value: money(total.amount),
        })),
      ],
      table: {
        columns: [
          t('Date', 'Date'),
          t('Mouvement', 'Movement'),
          t('Détail', 'Detail'),
          t('Montant', 'Amount'),
        ],
        rows: statement.lines.map((line) => [
          line.date,
          line.label,
          line.note.slice(0, 60),
          money(line.amount),
        ]),
        totals: [
          {
            label: t('Solde à la fin du mois', 'Closing balance'),
            value: money(statement.closing),
          },
        ],
      },
      footer: t(
        'Montants inscrits sur votre Solde KORVA : ventes payées en ligne, frais GeniusPay, change, commission KORVA, retraits.',
        'Amounts recorded on your KORVA balance: online sales, GeniusPay fees, exchange, KORVA commission, withdrawals.',
      ),
    };
  }
}
