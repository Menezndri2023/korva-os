import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { TillClosing as TillClosingView, TillReport } from '@korva/types';
import type { CloseTillInput } from '@korva/validation';
import { OrganizationsService } from '../../organizations/organizations.service';
import { UsersService } from '../../identity/users/users.service';
import { zonedTimeToUtc } from '../../booking/availability/availability.service';
import {
  Payment,
  type PaymentDocument,
} from '../payments/schemas/payment.schema';
import {
  TillClosing,
  type TillClosingDocument,
} from './schemas/till-closing.schema';

const DAY_MS = 24 * 60 * 60 * 1000;
const COUNTER_KEY_PREFIX = 'counter:';

/** A payment method typed by hand ("cash", "espèces", "liquide"…) that means notes and coins. */
const CASH_METHOD = /^(cash|esp[eè]ces?|liquide)$/i;

function methodKey(method: string | undefined): string {
  const value = (method ?? '').trim().toLowerCase();
  if (!value) return '';
  return CASH_METHOD.test(value) ? 'cash' : value;
}

function methodLabel(key: string): string {
  if (key === 'cash') return 'Espèces';
  if (key === 'online') return 'Mobile money (QR et en ligne)';
  if (key === '') return 'Non précisé';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

/**
 * The till report and its daily closing (plan feature `cash_closing`). Reads the payments
 * already recorded — counter QR, payments recorded by hand on an invoice, online payments — so
 * there is nothing new to type during the day; the closing only asks what was counted.
 */
@Injectable()
export class TillService {
  constructor(
    @InjectModel(Payment.name)
    private readonly paymentModel: Model<PaymentDocument>,
    @InjectModel(TillClosing.name)
    private readonly closingModel: Model<TillClosingDocument>,
    private readonly organizationsService: OrganizationsService,
    private readonly usersService: UsersService,
  ) {}

  async report(organizationId: string, day?: string): Promise<TillReport> {
    const organization =
      await this.organizationsService.getById(organizationId);
    const timeZone = organization.timezone || 'UTC';
    const reportDay =
      day ?? new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
    const start = zonedTimeToUtc(reportDay, '00:00', timeZone);
    const createdAt = { $gte: start, $lt: new Date(start.getTime() + DAY_MS) };
    const orgId = new Types.ObjectId(organizationId);

    const [payments, counterUnpaid, closing] = await Promise.all([
      this.paymentModel
        .find({ organizationId: orgId, status: 'completed', createdAt })
        .select({ amount: 1, method: 1, recordedBy: 1 })
        .lean(),
      this.paymentModel.countDocuments({
        organizationId: orgId,
        createdAt,
        idempotencyKey: { $regex: `^${COUNTER_KEY_PREFIX}` },
        status: { $in: ['pending', 'processing', 'failed'] },
      }),
      this.closingModel.findOne({ organizationId: orgId, day: reportDay }),
    ]);

    const byMethod = new Map<string, { total: number; count: number }>();
    const byStaff = new Map<string, { total: number; count: number }>();
    let total = 0;
    for (const payment of payments) {
      total += payment.amount;
      const method = methodKey(payment.method);
      const m = byMethod.get(method) ?? { total: 0, count: 0 };
      m.total += payment.amount;
      m.count += 1;
      byMethod.set(method, m);
      const staff = payment.recordedBy ? payment.recordedBy.toString() : '';
      const s = byStaff.get(staff) ?? { total: 0, count: 0 };
      s.total += payment.amount;
      s.count += 1;
      byStaff.set(staff, s);
    }
    const names = new Map<string, string>();
    await Promise.all(
      [...byStaff.keys()]
        .filter((id) => id !== '')
        .map(async (id) => {
          const user = await this.usersService.findById(id);
          names.set(
            id,
            user
              ? [user.firstName, user.lastName].filter(Boolean).join(' ') ||
                  user.email
              : 'Ancien membre',
          );
        }),
    );

    return {
      day: reportDay,
      currency: organization.currency,
      total,
      count: payments.length,
      byMethod: [...byMethod.entries()]
        .map(([method, sum]) => ({
          method,
          label: methodLabel(method),
          ...sum,
        }))
        .sort((a, b) => b.total - a.total),
      byStaff: [...byStaff.entries()]
        .map(([userId, sum]) => ({
          userId: userId || null,
          name: userId
            ? (names.get(userId) ?? 'Ancien membre')
            : 'Client en ligne',
          ...sum,
        }))
        .sort((a, b) => b.total - a.total),
      counterUnpaid,
      expectedCash: byMethod.get('cash')?.total ?? 0,
      closing: closing ? this.toView(closing) : null,
    };
  }

  /** Closes a day once; the report's figures at that moment are kept with the count. */
  async close(
    organizationId: string,
    userId: string,
    input: CloseTillInput,
  ): Promise<TillClosingView> {
    const report = await this.report(organizationId, input.day);
    const user = await this.usersService.findById(userId);
    try {
      const closing = await this.closingModel.create({
        organizationId: new Types.ObjectId(organizationId),
        day: report.day,
        closedBy: new Types.ObjectId(userId),
        closedByName: user
          ? [user.firstName, user.lastName].filter(Boolean).join(' ') ||
            user.email
          : 'Membre',
        countedCash: input.countedCash,
        expectedCash: report.expectedCash,
        total: report.total,
        currency: report.currency,
        note: input.note || undefined,
      });
      return this.toView(closing);
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      throw new ConflictException({
        code: 'TILL_ALREADY_CLOSED',
        message: 'This day is already closed',
      });
    }
  }

  async listClosings(organizationId: string): Promise<TillClosingView[]> {
    const closings = await this.closingModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ day: -1 })
      .limit(31);
    return closings.map((closing) => this.toView(closing));
  }

  private toView(closing: TillClosingDocument): TillClosingView {
    return {
      id: closing.id as string,
      day: closing.day,
      closedAt: (
        closing as unknown as { createdAt: Date }
      ).createdAt.toISOString(),
      closedByName: closing.closedByName,
      countedCash: closing.countedCash,
      expectedCash: closing.expectedCash,
      difference:
        Math.round((closing.countedCash - closing.expectedCash) * 100) / 100,
      total: closing.total,
      note: closing.note,
    };
  }
}
