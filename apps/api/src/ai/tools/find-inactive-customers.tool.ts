import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AiTool } from './tool.interface';
import { Order } from '../../commerce/orders/schemas/order.schema';
import { Booking } from '../../booking/bookings/schemas/booking.schema';
import { Contact } from '../../crm/contacts/schemas/contact.schema';

const inputSchema = z.object({
  sinceDays: z.number().int().min(1).max(730).optional(),
  offerId: z.string().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});
type Input = z.infer<typeof inputSchema>;

/**
 * Customers to win back: no order and no booking for `sinceDays` (default 60) — or, with
 * `offerId`, who have not taken THAT offer in the period (an association's members who have not
 * paid this year's membership, a salon's clients who never came back for the same service).
 * Read-only, straight from the collections: no service exposes "who did NOT buy".
 */
@Injectable()
export class FindInactiveCustomersTool implements AiTool<Input> {
  readonly definition = {
    name: 'find_inactive_customers',
    description:
      "Clients à relancer : sans commande ni réservation depuis sinceDays jours (60 par défaut). Avec offerId : ceux qui n'ont pas pris cette offre dans la période (ex. adhésion de l'année : sinceDays 365). Renvoie aussi la date de leur dernier achat.",
    inputSchema: {
      type: 'object',
      properties: {
        sinceDays: { type: 'number' },
        offerId: {
          type: 'string',
          description: 'Un id renvoyé par search_offers',
        },
        limit: { type: 'number', description: '20 par défaut' },
      },
    },
  };
  readonly requiredPermission = 'contacts.read' as const;
  readonly auditEntity = 'contact';

  constructor(
    @InjectModel(Contact.name) private readonly contactModel: Model<Contact>,
    @InjectModel(Order.name) private readonly orderModel: Model<Order>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
  ) {}

  parseInput(raw: unknown) {
    return inputSchema.parse(raw ?? {});
  }

  async execute(organizationId: string, _userId: string, input: Input) {
    const org = new Types.ObjectId(organizationId);
    const since = new Date(Date.now() - (input.sinceDays ?? 60) * 86_400_000);
    const offer =
      input.offerId && Types.ObjectId.isValid(input.offerId)
        ? new Types.ObjectId(input.offerId)
        : undefined;

    const [orders, bookings] = await Promise.all([
      this.orderModel
        .aggregate<{ _id: Types.ObjectId; last: Date }>([
          {
            $match: {
              organizationId: org,
              status: { $ne: 'cancelled' },
              ...(offer ? { 'items.offerId': offer } : {}),
            },
          },
          { $group: { _id: '$contactId', last: { $max: '$createdAt' } } },
        ])
        .exec(),
      this.bookingModel
        .aggregate<{ _id: Types.ObjectId; last: Date }>([
          {
            $match: {
              organizationId: org,
              status: { $ne: 'cancelled' },
              ...(offer ? { offerId: offer } : {}),
            },
          },
          { $group: { _id: '$contactId', last: { $max: '$startAt' } } },
        ])
        .exec(),
    ]);
    const lastActivity = new Map<string, Date>();
    for (const row of [...orders, ...bookings]) {
      const key = String(row._id);
      const known = lastActivity.get(key);
      if (!known || row.last > known) lastActivity.set(key, row.last);
    }

    const contacts = await this.contactModel
      .find(
        { organizationId: org },
        { firstName: 1, lastName: 1, company: 1, phone: 1, email: 1 },
      )
      .limit(1000)
      .lean()
      .exec();
    const inactive = contacts
      .map((contact) => ({
        contact,
        last: lastActivity.get(String(contact._id)),
      }))
      .filter(({ last }) => !last || last < since)
      .sort((a, b) => (b.last?.getTime() ?? 0) - (a.last?.getTime() ?? 0));

    return {
      total: inactive.length,
      customers: inactive
        .slice(0, input.limit ?? 20)
        .map(({ contact, last }) => ({
          id: String(contact._id),
          name:
            [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
            contact.company ||
            '—',
          phone: contact.phone,
          email: contact.email,
          lastPurchaseOrVisit: last
            ? last.toISOString().slice(0, 10)
            : 'jamais',
        })),
    };
  }
}
