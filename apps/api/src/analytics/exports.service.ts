import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { DataExport, DataExportKind } from '@korva/types';
import type { DataExportQuery } from '@korva/validation';
import {
  Booking,
  BookingDocument,
} from '../booking/bookings/schemas/booking.schema';
import { Order, OrderDocument } from '../commerce/orders/schemas/order.schema';
import {
  Invoice,
  InvoiceDocument,
} from '../finance/invoices/schemas/invoice.schema';
import {
  Organization,
  OrganizationDocument,
} from '../organizations/schemas/organization.schema';
import { Offer, OfferDocument } from '../catalog/offers/schemas/offer.schema';
import {
  Contact,
  ContactDocument,
} from '../crm/contacts/schemas/contact.schema';
import { zonedTimeToUtc } from '../booking/availability/availability.service';

/** One file carries at most this many rows; the rest of the period needs a shorter range. */
export const EXPORT_ROW_LIMIT = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 30;

const ORDER_STATUS_LABELS: Record<string, string> = {
  open: 'Ouverte',
  pending: 'En attente',
  confirmed: 'Confirmée',
  fulfilled: 'Livrée',
  cancelled: 'Annulée',
};
const BOOKING_STATUS_LABELS: Record<string, string> = {
  pending: 'En attente',
  confirmed: 'Confirmée',
  cancelled: 'Annulée',
  completed: 'Terminée',
};
const PAYMENT_STATUS_LABELS: Record<string, string> = {
  unpaid: 'Non payée',
  deposit_paid: 'Acompte payé',
  paid: 'Payée',
};

type Cell = string | number | null | undefined;

/** Byte order mark: without it Excel reads the UTF-8 file as Latin-1 and breaks every accent. */
const BOM = String.fromCharCode(0xfeff);

/** Every document here has Mongoose timestamps; the schema classes just do not declare them. */
function createdAt(document: object): Date {
  return (document as { createdAt: Date }).createdAt;
}

/** A cell for French Excel: semicolons and quotes escaped, decimal comma. */
function cell(value: Cell): string {
  if (value === null || value === undefined) return '';
  const text =
    typeof value === 'number' ? String(value).replace('.', ',') : value;
  // A leading =, +, - or @ would be read by Excel as a formula (CSV injection): prefix a quote.
  const safe =
    /^[=+\-@]/.test(text) && typeof value !== 'number' ? `'${text}` : text;
  return /[;"\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function toCsv(header: string[], rows: Cell[][]): string {
  const lines = [header, ...rows].map((row) => row.map(cell).join(';'));
  return `${BOM}${lines.join('\r\n')}\r\n`;
}

function contactName(contact: Partial<Contact> | undefined): string {
  if (!contact) return '';
  return (
    [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
    contact.company ||
    contact.email ||
    contact.phone ||
    ''
  );
}

/**
 * The dashboard's exports: one CSV per kind, over a period of calendar days in the
 * organization's own timezone. Pro (data_export) for orders, bookings and contacts; Business
 * (accounting_export) for the sales journal — the controller holds both gates.
 */
@Injectable()
export class ExportsService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(Invoice.name)
    private readonly invoiceModel: Model<InvoiceDocument>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
    @InjectModel(Offer.name) private readonly offerModel: Model<OfferDocument>,
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
  ) {}

  async export(
    organizationId: string,
    kind: DataExportKind,
    query: DataExportQuery,
  ): Promise<DataExport> {
    const organization = await this.organizationModel
      .findById(organizationId)
      .select({ slug: 1, timezone: 1 })
      .lean();
    const timeZone = organization?.timezone ?? 'UTC';
    const today = this.day(new Date(), timeZone);
    const to = query.to ?? today;
    const from =
      query.from ??
      this.day(new Date(Date.now() - (DEFAULT_DAYS - 1) * DAY_MS), timeZone);
    const range = {
      $gte: zonedTimeToUtc(from, '00:00', timeZone),
      $lt: new Date(zonedTimeToUtc(to, '00:00', timeZone).getTime() + DAY_MS),
    };
    const scope = {
      organizationId: new Types.ObjectId(organizationId),
      createdAt: range,
    };
    const day = (date: Date | undefined) =>
      date ? this.day(date, timeZone) : '';

    let header: string[];
    let rows: Cell[][];
    switch (kind) {
      case 'orders': {
        const orders = await this.orderModel
          .find(scope)
          .sort({ createdAt: 1 })
          .limit(EXPORT_ROW_LIMIT + 1)
          .lean();
        const contacts = await this.contacts(orders.map((o) => o.contactId));
        header = [
          'Date',
          'Numéro',
          'Client',
          'Téléphone',
          'Statut',
          'Articles',
          'Sous-total',
          'Remise',
          'Livraison',
          'TVA',
          'Total',
          'Devise',
        ];
        rows = orders.map((order) => {
          const contact = contacts.get(order.contactId.toString());
          return [
            day(createdAt(order)),
            order.number,
            contactName(contact),
            contact?.phone,
            ORDER_STATUS_LABELS[order.status] ?? order.status,
            order.items
              .map((item) => `${item.quantity} × ${item.description}`)
              .join(', '),
            order.subtotal,
            order.discountTotal,
            order.shippingCost,
            order.taxTotal,
            order.total,
            order.currency,
          ];
        });
        break;
      }
      case 'bookings': {
        const bookings = await this.bookingModel
          .find(scope)
          .sort({ startAt: 1 })
          .limit(EXPORT_ROW_LIMIT + 1)
          .lean();
        const [contacts, offers] = await Promise.all([
          this.contacts(bookings.map((b) => b.contactId)),
          this.offerModel
            .find({ _id: { $in: bookings.map((b) => b.offerId) } })
            .select({ name: 1 })
            .lean(),
        ]);
        const offerName = new Map(
          offers.map((o) => [o._id.toString(), o.name]),
        );
        header = [
          'Réservée le',
          'Date',
          'Heure',
          'Prestation',
          'Client',
          'Téléphone',
          'Statut',
          'Paiement',
          'Montant',
          'Devise',
        ];
        rows = bookings.map((booking) => {
          const contact = contacts.get(booking.contactId.toString());
          return [
            day(createdAt(booking)),
            day(booking.startAt),
            new Intl.DateTimeFormat('fr-FR', {
              timeZone,
              hour: '2-digit',
              minute: '2-digit',
            }).format(booking.startAt),
            offerName.get(booking.offerId.toString()) ?? '',
            contactName(contact),
            contact?.phone,
            BOOKING_STATUS_LABELS[booking.status] ?? booking.status,
            PAYMENT_STATUS_LABELS[booking.paymentStatus] ??
              booking.paymentStatus,
            booking.pricing.amount,
            booking.pricing.currency,
          ];
        });
        break;
      }
      case 'contacts': {
        const contacts = await this.contactModel
          .find(scope)
          .sort({ createdAt: 1 })
          .limit(EXPORT_ROW_LIMIT + 1)
          .lean();
        header = [
          'Ajouté le',
          'Prénom',
          'Nom',
          'Entreprise',
          'E-mail',
          'Téléphone',
          'Étiquettes',
        ];
        rows = contacts.map((contact) => [
          day(createdAt(contact)),
          contact.firstName,
          contact.lastName,
          contact.company,
          contact.email,
          contact.phone,
          (contact.tags ?? []).join(', '),
        ]);
        break;
      }
      case 'sales-journal':
        ({ header, rows } = await this.salesJournal(scope, day));
        break;
    }

    const truncated = rows.length > EXPORT_ROW_LIMIT;
    if (truncated) rows = rows.slice(0, EXPORT_ROW_LIMIT);
    return {
      filename: `${organization?.slug ?? 'korva'}-${kind}-${from}-au-${to}.csv`,
      csv: toCsv(header, rows),
      rows: rows.length,
      truncated,
    };
  }

  /**
   * One line per sale, for an accountant: every issued invoice (draft and cancelled ones are not
   * sales), and every confirmed or delivered order that has no invoice — an invoiced order is
   * already counted through its invoice. Amounts before tax, tax, and total, then what was
   * collected; a VAT summary per rate closes the file.
   */
  private async salesJournal(
    scope: { organizationId: Types.ObjectId; createdAt: Record<string, Date> },
    day: (date: Date | undefined) => string,
  ): Promise<{ header: string[]; rows: Cell[][] }> {
    const [invoices, orders] = await Promise.all([
      this.invoiceModel
        .find({
          organizationId: scope.organizationId,
          status: { $nin: ['draft', 'cancelled'] },
          $or: [
            { issuedAt: scope.createdAt },
            { issuedAt: { $exists: false }, createdAt: scope.createdAt },
          ],
        })
        .limit(EXPORT_ROW_LIMIT + 1)
        .lean(),
      this.orderModel
        .find({
          ...scope,
          status: { $in: ['confirmed', 'fulfilled'] },
          invoiceId: { $exists: false },
        })
        .limit(EXPORT_ROW_LIMIT + 1)
        .lean(),
    ]);
    const contacts = await this.contacts([
      ...invoices.map((i) => i.contactId),
      ...orders.map((o) => o.contactId),
    ]);

    type Entry = {
      date: Date;
      piece: string;
      type: string;
      contactId: Types.ObjectId;
      items: { quantity: number; unitPrice: number; taxRate?: number }[];
      net: number;
      tax: number;
      total: number;
      collected: number;
      currency: string;
    };
    const entries: Entry[] = [
      ...invoices.map((invoice) => ({
        date: invoice.issuedAt ?? createdAt(invoice),
        piece: invoice.number,
        type: 'Facture',
        contactId: invoice.contactId,
        items: invoice.items,
        net: invoice.subtotal - invoice.discountTotal,
        tax: invoice.taxTotal,
        total: invoice.total,
        collected: invoice.amountPaid,
        currency: invoice.currency,
      })),
      ...orders.map((order) => ({
        date: createdAt(order),
        piece: order.number,
        type: 'Commande',
        contactId: order.contactId,
        items: order.items,
        net: order.total - order.taxTotal,
        tax: order.taxTotal,
        total: order.total,
        // A confirmed order without an invoice is a cash or online sale already settled.
        collected: order.total,
        currency: order.currency,
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    const header = [
      'Date',
      'Pièce',
      'Type',
      'Client',
      'Montant HT',
      'TVA',
      'Montant TTC',
      'Encaissé',
      'Reste dû',
      'Devise',
    ];
    const rows: Cell[][] = entries.map((entry) => [
      day(entry.date),
      entry.piece,
      entry.type,
      contactName(contacts.get(entry.contactId.toString())),
      entry.net,
      entry.tax,
      entry.total,
      entry.collected,
      Math.max(0, entry.total - entry.collected),
      entry.currency,
    ]);

    // VAT per rate, from the lines (the documents only store the tax total).
    const byRate = new Map<number, { base: number; tax: number }>();
    for (const entry of entries) {
      for (const item of entry.items) {
        const rate = item.taxRate ?? 0;
        const base = item.quantity * item.unitPrice;
        const sum = byRate.get(rate) ?? { base: 0, tax: 0 };
        sum.base += base;
        sum.tax += Math.round(base * rate) / 100;
        byRate.set(rate, sum);
      }
    }
    if (byRate.size > 0) {
      rows.push([]);
      rows.push(['Récapitulatif TVA', '', '', 'Taux', 'Base HT', 'TVA']);
      for (const [rate, sum] of [...byRate.entries()].sort(
        (a, b) => a[0] - b[0],
      )) {
        rows.push([
          '',
          '',
          '',
          `${String(rate).replace('.', ',')} %`,
          sum.base,
          sum.tax,
        ]);
      }
    }
    return { header, rows };
  }

  private async contacts(
    ids: Types.ObjectId[],
  ): Promise<Map<string, Partial<Contact>>> {
    const unique = [...new Set(ids.map((id) => id.toString()))];
    const contacts = await this.contactModel
      .find({ _id: { $in: unique.map((id) => new Types.ObjectId(id)) } })
      .select({ firstName: 1, lastName: 1, company: 1, email: 1, phone: 1 })
      .lean();
    return new Map(contacts.map((c) => [c._id.toString(), c]));
  }

  private day(date: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
  }
}
