import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import type { ContactLoyalty, LoyaltySettings } from '@korva/types';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from '../../communication/providers/email-provider.interface';
import { translator } from '../../shared/i18n';

/** The walk-in contact the counter QR sells to (counter-payments.service.ts): no card for it. */
const WALK_IN_TAG = 'client-comptoir';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * La carte de fidélité (2026-11-07): one stamp per paid purchase or completed visit; every
 * `stampsRequired` stamps earn the reward the business chose ("la 10e coupe offerte"). Kept on
 * the contact, so it works for the customer whatever way they came — the site, the counter, a
 * booking. Each invoice and each booking stamps at most once (an atomic claim on its own
 * document), however often its payment is replayed.
 */
@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @Optional()
    @Inject(EMAIL_PROVIDER)
    private readonly emailProvider?: EmailProvider,
  ) {}

  private db() {
    return this.connection.db!;
  }

  private async settings(
    organizationId: string,
  ): Promise<(LoyaltySettings & { name: string; language?: string }) | null> {
    const organization = await this.db()
      .collection('organizations')
      .findOne(
        { _id: new Types.ObjectId(organizationId) },
        { projection: { loyalty: 1, name: 1, language: 1 } },
      );
    const loyalty = organization?.loyalty as LoyaltySettings | undefined;
    if (!loyalty?.enabled || !loyalty.stampsRequired) return null;
    return {
      ...loyalty,
      name: organization!.name as string,
      language: organization!.language as string | undefined,
    };
  }

  /** A fully paid invoice stamps its contact once. Never throws. */
  async stampForInvoice(
    organizationId: string,
    invoiceId: string,
  ): Promise<void> {
    try {
      const settings = await this.settings(organizationId);
      if (!settings) return;
      const invoice = await this.db()
        .collection('invoices')
        .findOneAndUpdate(
          {
            _id: new Types.ObjectId(invoiceId),
            organizationId: new Types.ObjectId(organizationId),
            status: 'paid',
            loyaltyStampedAt: { $exists: false },
          },
          { $set: { loyaltyStampedAt: new Date() } },
          { projection: { contactId: 1 } },
        );
      if (!invoice?.contactId) return;
      await this.addStamp(
        organizationId,
        invoice.contactId as Types.ObjectId,
        settings,
      );
    } catch (error) {
      this.logger.warn(
        `Loyalty stamp for invoice ${invoiceId} failed: ${String(error)}`,
      );
    }
  }

  /** A completed visit stamps its contact once — unless it was invoiced, which stamps on payment. */
  async stampForBooking(
    organizationId: string,
    bookingId: string,
  ): Promise<void> {
    try {
      const settings = await this.settings(organizationId);
      if (!settings) return;
      const id = new Types.ObjectId(bookingId);
      const invoiced = await this.db()
        .collection('orders')
        .findOne(
          { bookingId: id, invoiceId: { $exists: true } },
          { projection: { _id: 1 } },
        );
      if (invoiced) return;
      const booking = await this.db()
        .collection('bookings')
        .findOneAndUpdate(
          {
            _id: id,
            organizationId: new Types.ObjectId(organizationId),
            status: 'completed',
            loyaltyStampedAt: { $exists: false },
          },
          { $set: { loyaltyStampedAt: new Date() } },
          { projection: { contactId: 1 } },
        );
      if (!booking?.contactId) return;
      await this.addStamp(
        organizationId,
        booking.contactId as Types.ObjectId,
        settings,
      );
    } catch (error) {
      this.logger.warn(
        `Loyalty stamp for booking ${bookingId} failed: ${String(error)}`,
      );
    }
  }

  /** The business adds a stamp by hand (a visit paid in cash, never recorded). */
  async stampByHand(
    organizationId: string,
    contactId: string,
  ): Promise<ContactLoyalty> {
    const settings = await this.settings(organizationId);
    if (!settings) {
      throw new BadRequestException({
        code: 'LOYALTY_NOT_ENABLED',
        message: 'Turn the loyalty card on in Settings first',
      });
    }
    await this.addStamp(
      organizationId,
      new Types.ObjectId(contactId),
      settings,
    );
    return this.forContact(organizationId, contactId);
  }

  /** The customer takes their reward: one reward's worth of stamps is used. */
  async redeem(
    organizationId: string,
    contactId: string,
  ): Promise<ContactLoyalty> {
    const settings = await this.settings(organizationId);
    if (!settings) {
      throw new BadRequestException({
        code: 'LOYALTY_NOT_ENABLED',
        message: 'Turn the loyalty card on in Settings first',
      });
    }
    const updated = await this.db()
      .collection('contacts')
      .updateOne(
        {
          _id: new Types.ObjectId(contactId),
          organizationId: new Types.ObjectId(organizationId),
          'loyalty.stamps': { $gte: settings.stampsRequired },
        },
        {
          $inc: {
            'loyalty.stamps': -settings.stampsRequired,
            'loyalty.rewardsUsed': 1,
          },
        },
      );
    if (updated.modifiedCount === 0) {
      throw new BadRequestException({
        code: 'LOYALTY_NO_REWARD',
        message: 'Not enough stamps for a reward yet',
      });
    }
    return this.forContact(organizationId, contactId);
  }

  async forContact(
    organizationId: string,
    contactId: string,
  ): Promise<ContactLoyalty> {
    const [settings, contact] = await Promise.all([
      this.settings(organizationId),
      this.db()
        .collection('contacts')
        .findOne(
          {
            _id: new Types.ObjectId(contactId),
            organizationId: new Types.ObjectId(organizationId),
          },
          { projection: { loyalty: 1 } },
        ),
    ]);
    if (!contact)
      throw new NotFoundException({
        code: 'CONTACT_NOT_FOUND',
        message: 'Contact not found',
      });
    const stamps =
      (contact.loyalty as { stamps?: number } | undefined)?.stamps ?? 0;
    const required = settings?.stampsRequired ?? 0;
    return {
      enabled: !!settings,
      stamps,
      stampsRequired: required,
      reward: settings?.reward ?? '',
      rewardsAvailable: required > 0 ? Math.floor(stamps / required) : 0,
      rewardsUsed:
        (contact.loyalty as { rewardsUsed?: number } | undefined)
          ?.rewardsUsed ?? 0,
    };
  }

  private async addStamp(
    organizationId: string,
    contactId: Types.ObjectId,
    settings: LoyaltySettings & { name: string; language?: string },
  ): Promise<void> {
    const contact = await this.db()
      .collection('contacts')
      .findOneAndUpdate(
        {
          _id: contactId,
          organizationId: new Types.ObjectId(organizationId),
          tags: { $ne: WALK_IN_TAG },
        },
        { $inc: { 'loyalty.stamps': 1 } },
        {
          returnDocument: 'after',
          projection: { loyalty: 1, email: 1, firstName: 1 },
        },
      );
    if (!contact) return;
    const stamps =
      (contact.loyalty as { stamps?: number } | undefined)?.stamps ?? 0;
    // Just reached a reward: tell the customer, in the business's language.
    if (
      stamps > 0 &&
      stamps % settings.stampsRequired === 0 &&
      contact.email &&
      this.emailProvider
    ) {
      const t = translator(settings.language);
      await this.emailProvider
        .send({
          to: contact.email as string,
          subject: t(
            `${settings.name} : votre récompense fidélité vous attend`,
            `${settings.name}: your loyalty reward is waiting`,
          ),
          body: t(
            `<p>Bonjour ${escapeHtml((contact.firstName as string | undefined) ?? '')},</p><p>Votre carte de fidélité ${escapeHtml(settings.name)} est complète : <strong>${escapeHtml(settings.reward)}</strong>. Elle vous attend à votre prochaine visite.</p>`,
            `<p>Hello ${escapeHtml((contact.firstName as string | undefined) ?? '')},</p><p>Your ${escapeHtml(settings.name)} loyalty card is full: <strong>${escapeHtml(settings.reward)}</strong>. It is waiting for your next visit.</p>`,
          ),
        })
        .catch(() => undefined);
    }
  }
}
