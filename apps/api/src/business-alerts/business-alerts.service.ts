import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Organization } from '../organizations/schemas/organization.schema';
import { Membership } from '../identity/schemas/membership.schema';
import { User } from '../identity/schemas/user.schema';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from '../communication/providers/email-provider.interface';
import { intlLocaleOf, translator } from '../shared/i18n';

export type BusinessAlert =
  | {
      kind: 'order';
      number: string;
      total: number;
      currency: string;
      customer: string;
    }
  | { kind: 'booking'; offerName: string; startAt: Date; customer: string }
  | {
      kind: 'booking_cancelled';
      offerName: string;
      startAt: Date;
      customer: string;
      /** What the customer already paid online, which the business now owes back. */
      refund?: { amount: number; currency: string };
    }
  | { kind: 'request'; message: string; customer: string }
  | {
      kind: 'online_payment';
      amount: number;
      currency: string;
      invoiceNumber?: string;
    };

/** How an alert names the customer: first name and e-mail when known. */
export function customerLabel(contact: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
}): string {
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
  return name && contact.email
    ? `${name} (${contact.email})`
    : name || contact.email || 'Un client';
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * Tells the business, by e-mail, that something happened on its site: an order, a booking, a
 * request (quote, visit, information) or an online payment. Before it (2026-11-07 journey check),
 * a business learnt of a new order only from an in-app notification — and only if the starter
 * workflow had been created at onboarding — so an owner away from the dashboard missed customers.
 *
 * Sent to the organization's owner (its first active member, as ActivationNudgeService does), in
 * the business's language. Never throws: a failed alert must not fail the customer's order.
 */
@Injectable()
export class BusinessAlertsService {
  private readonly logger = new Logger(BusinessAlertsService.name);

  constructor(
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    @InjectModel(Membership.name)
    private readonly membershipModel: Model<Membership>,
    @InjectModel(User.name) private readonly userModel: Model<User>,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    private readonly configService: ConfigService,
  ) {}

  async notify(organizationId: string, alert: BusinessAlert): Promise<void> {
    try {
      const organization = await this.organizationModel
        .findById(organizationId, { name: 1, language: 1 })
        .lean<{ name: string; language?: string }>()
        .exec();
      if (!organization) return;
      const to = await this.ownerEmail(new Types.ObjectId(organizationId));
      if (!to) return;
      const t = translator(organization.language);
      const locale = intlLocaleOf(organization.language);
      const money = (amount: number, currency: string) =>
        new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
          amount,
        );
      const appUrl = (
        this.configService.get<string>('APP_URL') ?? 'http://localhost:3000'
      ).replace(/\/$/, '');
      const name = escapeHtml(organization.name);

      const { subject, lines, link } = ((): {
        subject: string;
        lines: string[];
        link: string;
      } => {
        switch (alert.kind) {
          case 'order':
            return {
              subject: t(
                `Nouvelle commande ${alert.number} — ${money(alert.total, alert.currency)}`,
                `New order ${alert.number} — ${money(alert.total, alert.currency)}`,
              ),
              lines: [
                t(
                  `${escapeHtml(alert.customer)} vient de passer la commande <strong>${escapeHtml(alert.number)}</strong> sur le site de ${name}, pour ${money(alert.total, alert.currency)}.`,
                  `${escapeHtml(alert.customer)} has just placed order <strong>${escapeHtml(alert.number)}</strong> on ${name}'s site, for ${money(alert.total, alert.currency)}.`,
                ),
              ],
              link: `${appUrl}/dashboard/orders`,
            };
          case 'booking':
            return {
              subject: t(
                `Nouvelle réservation — ${alert.offerName}`,
                `New booking — ${alert.offerName}`,
              ),
              lines: [
                t(
                  `${escapeHtml(alert.customer)} a réservé « ${escapeHtml(alert.offerName)} » pour le ${alert.startAt.toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short' })}.`,
                  `${escapeHtml(alert.customer)} booked “${escapeHtml(alert.offerName)}” for ${alert.startAt.toLocaleString(locale, { dateStyle: 'full', timeStyle: 'short' })}.`,
                ),
              ],
              link: `${appUrl}/dashboard/bookings`,
            };
          case 'booking_cancelled': {
            const when = alert.startAt.toLocaleString(locale, {
              dateStyle: 'full',
              timeStyle: 'short',
            });
            return {
              subject: t(
                `Réservation annulée par le client — ${alert.offerName}`,
                `Booking cancelled by the customer — ${alert.offerName}`,
              ),
              lines: [
                t(
                  `${escapeHtml(alert.customer)} a annulé sa réservation « ${escapeHtml(alert.offerName)} » du ${when}, dans le délai d'annulation gratuite. Le créneau est de nouveau libre.`,
                  `${escapeHtml(alert.customer)} cancelled their booking “${escapeHtml(alert.offerName)}” on ${when}, within the free cancellation period. The slot is free again.`,
                ),
                ...(alert.refund
                  ? [
                      t(
                        `<strong>À rembourser : ${money(alert.refund.amount, alert.refund.currency)}</strong>, déjà payés en ligne par le client.`,
                        `<strong>To refund: ${money(alert.refund.amount, alert.refund.currency)}</strong>, already paid online by the customer.`,
                      ),
                    ]
                  : []),
              ],
              link: `${appUrl}/dashboard/bookings`,
            };
          }
          case 'request':
            return {
              subject: t(
                `Nouvelle demande de ${alert.customer}`,
                `New request from ${alert.customer}`,
              ),
              lines: [
                t(
                  `${escapeHtml(alert.customer)} vous a écrit depuis le site de ${name} :`,
                  `${escapeHtml(alert.customer)} wrote to you from ${name}'s site:`,
                ),
                `<blockquote style="margin:0;padding:8px 12px;border-left:3px solid #ccc">${escapeHtml(alert.message).replace(/\n/g, '<br>')}</blockquote>`,
              ],
              link: `${appUrl}/dashboard/crm/leads`,
            };
          case 'online_payment':
            return {
              subject: t(
                `Paiement en ligne reçu — ${money(alert.amount, alert.currency)}`,
                `Online payment received — ${money(alert.amount, alert.currency)}`,
              ),
              lines: [
                t(
                  `Un client a payé ${money(alert.amount, alert.currency)} en ligne${alert.invoiceNumber ? ` (facture ${escapeHtml(alert.invoiceNumber)})` : ''}. Le montant, frais déduits, est sur votre Solde KORVA.`,
                  `A customer paid ${money(alert.amount, alert.currency)} online${alert.invoiceNumber ? ` (invoice ${escapeHtml(alert.invoiceNumber)})` : ''}. The amount, less fees, is on your KORVA balance.`,
                ),
              ],
              link: `${appUrl}/dashboard/solde`,
            };
        }
      })();

      await this.emailProvider.send({
        to,
        subject,
        body:
          lines
            .map((line) =>
              line.startsWith('<blockquote') ? line : `<p>${line}</p>`,
            )
            .join('') +
          `<p><a href="${link}">${t('Ouvrir dans KORVA', 'Open in KORVA')}</a></p>`,
      });
    } catch (error) {
      this.logger.warn(
        `Business alert (${alert.kind}) for ${organizationId} not sent: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** The organization's first active member — the person who created it. */
  private async ownerEmail(
    organizationId: Types.ObjectId,
  ): Promise<string | null> {
    const membership = await this.membershipModel
      .findOne({ organizationId, status: 'active' })
      .sort({ createdAt: 1 })
      .lean<{ userId: Types.ObjectId }>()
      .exec();
    if (!membership) return null;
    const user = await this.userModel
      .findById(membership.userId, { email: 1 })
      .lean<{ email: string }>()
      .exec();
    return user?.email ?? null;
  }
}
