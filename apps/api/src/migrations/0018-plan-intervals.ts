import type { Types } from 'mongoose';
import { priceForInterval, type PlanInterval } from '@korva/types';
import type { MigrationDefinition } from '../core/migrations/migration.types';

/** The fields of a plan row this migration reads — see 0003 for why the raw driver needs them. */
type PlanRow = {
  _id: Types.ObjectId;
  key: string;
  name: string;
  priceAmount: number;
  priceCurrency: string;
  interval?: string;
  modules: string[];
  limits: Record<string, number>;
};

const LONG_INTERVALS: PlanInterval[] = ['half_year', 'year'];

/**
 * 6-month and yearly billing (owner's decision of 2026-11-27): every paid tier, in every
 * currency, gets two more Plan documents next to its monthly one.
 *
 * 1. Every plan without an interval is marked monthly — the only duration that existed.
 * 2. syncIndexes() swaps the unique { key, priceCurrency } index for { key, priceCurrency,
 *    interval }: with the old one in place, a second "Pro in XOF" could not exist. Production
 *    runs autoIndex off, so this has to happen here, and BEFORE step 3.
 * 3. For each paid monthly plan, the 6-month and yearly versions are created from the monthly
 *    price ACTUALLY STORED (priceForInterval: 6 months at 90 %, a year at 10 months), with its
 *    name, modules and limits — a price set by hand with manage-plans.ts carries over.
 *    $setOnInsert: an existing long plan is never touched, so a re-run changes nothing.
 *
 * Partial-run safe: each step is idempotent. Subscriptions are not touched — they all point at
 * monthly plans, which keep their ids.
 */
export const migration: MigrationDefinition = {
  name: '0018-plan-intervals',
  async up(connection) {
    const plans = connection.collection<PlanRow>('plans');

    await plans.updateMany(
      { interval: { $exists: false } },
      { $set: { interval: 'month' } },
    );

    await connection.model('Plan').syncIndexes();

    const monthly = await plans
      .find({ interval: 'month', priceAmount: { $gt: 0 } })
      .toArray();
    const now = new Date();
    for (const plan of monthly) {
      for (const interval of LONG_INTERVALS) {
        await plans.updateOne(
          { key: plan.key, priceCurrency: plan.priceCurrency, interval },
          {
            $setOnInsert: {
              key: plan.key,
              name: plan.name,
              priceAmount: priceForInterval(plan.priceAmount, interval),
              priceCurrency: plan.priceCurrency,
              interval,
              modules: plan.modules,
              limits: plan.limits,
              createdAt: now,
              updatedAt: now,
            },
          },
          { upsert: true },
        );
      }
    }
  },
};

export default migration;
