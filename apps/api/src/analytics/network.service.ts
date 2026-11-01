import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { NetworkOverview } from '@korva/types';
import {
  Booking,
  BookingDocument,
} from '../booking/bookings/schemas/booking.schema';
import { Order, OrderDocument } from '../commerce/orders/schemas/order.schema';
import {
  Organization,
  OrganizationDocument,
} from '../organizations/schemas/organization.schema';
import {
  Contact,
  ContactDocument,
} from '../crm/contacts/schemas/contact.schema';
import {
  Payment,
  PaymentDocument,
} from '../finance/payments/schemas/payment.schema';
import { MembershipsService } from '../identity/memberships/memberships.service';

const PERIOD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The Business network view: every organization the person belongs to AND may read the figures
 * of (analytics.read in that organization's own role — never borrowed from the active one), each
 * with its last 30 days. A suspended organization is left out.
 */
@Injectable()
export class NetworkService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Booking.name)
    private readonly bookingModel: Model<BookingDocument>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<OrganizationDocument>,
    @InjectModel(Contact.name)
    private readonly contactModel: Model<ContactDocument>,
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    private readonly membershipsService: MembershipsService,
  ) {}

  async overview(userId: string): Promise<NetworkOverview> {
    const memberships =
      await this.membershipsService.listOrganizationIdsForUser(userId);
    const contexts = await Promise.all(
      memberships.map((membership) =>
        this.membershipsService.resolveTenantContext(
          userId,
          membership.organizationId.toString(),
        ),
      ),
    );
    const readable = contexts
      .filter(
        (context) =>
          context !== null &&
          !context.suspended &&
          context.permissions.includes('analytics.read'),
      )
      .map((context) => new Types.ObjectId(context!.organizationId));

    const organizations = await this.organizationModel
      .find({ _id: { $in: readable } })
      .select({ name: 1, slug: 1, businessModel: 1, currency: 1 })
      .sort({ name: 1 })
      .lean();
    const createdAt = { $gte: new Date(Date.now() - PERIOD_DAYS * DAY_MS) };

    const establishments = await Promise.all(
      organizations.map(async (organization) => {
        const organizationId = organization._id;
        const [orders, bookings, payments, newContacts] = await Promise.all([
          this.orderModel.aggregate<{ sales: number; count: number }>([
            {
              $match: {
                organizationId,
                status: { $in: ['confirmed', 'fulfilled'] },
                createdAt,
              },
            },
            {
              $group: {
                _id: null,
                sales: { $sum: '$total' },
                count: { $sum: 1 },
              },
            },
          ]),
          this.bookingModel.countDocuments({
            organizationId,
            status: { $in: ['confirmed', 'completed'] },
            createdAt,
          }),
          this.paymentModel.aggregate<{ total: number }>([
            { $match: { organizationId, status: 'completed', createdAt } },
            { $group: { _id: null, total: { $sum: '$amount' } } },
          ]),
          this.contactModel.countDocuments({ organizationId, createdAt }),
        ]);
        return {
          organizationId: organizationId.toString(),
          name: organization.name,
          slug: organization.slug,
          businessModel: organization.businessModel,
          currency: organization.currency,
          sales: orders[0]?.sales ?? 0,
          orders: orders[0]?.count ?? 0,
          bookings,
          collected: payments[0]?.total ?? 0,
          newContacts,
        };
      }),
    );
    return { periodDays: PERIOD_DAYS, establishments };
  }
}
