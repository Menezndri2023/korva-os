import { randomUUID } from 'node:crypto';
import mongoose, { type Connection } from 'mongoose';
import { PlanSchema } from '../../subscriptions/schemas/plan.schema';
import { migration } from '../0018-plan-intervals';

/**
 * 0018 against a real MongoDB shaped like production on 2026-11-27: twenty monthly plans under
 * the OLD unique { key, priceCurrency } index (autoIndex is off there, so only the migration can
 * change it), one row with no interval at all, and one monthly price changed by hand. Same local
 * replica set as the payment-lifecycle integration test.
 */
const MONGO_URI = `mongodb://korva:korva@localhost:27017/korva_test_m0018_${process.pid}_${randomUUID().slice(0, 8)}?authSource=admin&replicaSet=rs0`;

type Row = {
  key: string;
  priceCurrency: string;
  priceAmount: number;
  interval?: string;
  name: string;
  modules: string[];
  limits: Record<string, number>;
};

describe('migration 0018-plan-intervals (real MongoDB)', () => {
  let connection: Connection;

  beforeAll(async () => {
    connection = await mongoose
      .createConnection(MONGO_URI, { autoIndex: false })
      .asPromise();
    connection.model('Plan', PlanSchema);
    const plans = connection.collection<Row>('plans');
    await plans.createIndex({ key: 1, priceCurrency: 1 }, { unique: true });
    const prices: Record<string, number> = {
      free: 0,
      starter: 9900,
      pro: 24900,
      business: 59900,
    };
    for (const [key, price] of Object.entries(prices)) {
      await plans.insertOne({
        key,
        name: key,
        priceAmount: price,
        priceCurrency: 'XOF',
        interval: 'month',
        modules: ['crm'],
        limits: { seats: 3 },
      });
    }
    // A monthly price set by hand with manage-plans.ts — must carry over to the long plans.
    await plans.insertOne({
      key: 'pro',
      name: 'Pro',
      priceAmount: 79,
      priceCurrency: 'EUR',
      modules: ['crm', 'ai'],
      limits: { seats: 10 },
    });
  });

  afterAll(async () => {
    await connection.dropDatabase();
    await connection.close();
  });

  it('swaps the index, marks the old rows monthly, and adds the 6-month and yearly plans', async () => {
    await migration.up(connection);

    const plans = connection.collection<Row>('plans');
    expect(await plans.countDocuments({ interval: { $exists: false } })).toBe(
      0,
    );

    const indexes = await plans.indexes();
    const keys = indexes.map((index) => JSON.stringify(index.key));
    expect(keys).toContain(
      JSON.stringify({ key: 1, priceCurrency: 1, interval: 1 }),
    );
    expect(keys).not.toContain(JSON.stringify({ key: 1, priceCurrency: 1 }));

    const find = (key: string, currency: string, interval: string) =>
      plans.findOne({ key, priceCurrency: currency, interval });
    expect((await find('starter', 'XOF', 'half_year'))?.priceAmount).toBe(
      53460,
    );
    expect((await find('starter', 'XOF', 'year'))?.priceAmount).toBe(99000);
    expect((await find('business', 'XOF', 'year'))?.priceAmount).toBe(599000);
    // Free has nothing to prepay.
    expect(await find('free', 'XOF', 'year')).toBeNull();
    // Priced from the monthly price actually stored, with its modules and limits.
    const proEurYear = await find('pro', 'EUR', 'year');
    expect(proEurYear?.priceAmount).toBe(790);
    expect(proEurYear?.modules).toEqual(['crm', 'ai']);
    expect(proEurYear?.limits).toEqual({ seats: 10 });
    expect(await plans.countDocuments({})).toBe(5 + 4 * 2);
  });

  it('changes nothing when run again', async () => {
    const plans = connection.collection<Row>('plans');
    await plans.updateOne(
      { key: 'starter', priceCurrency: 'XOF', interval: 'year' },
      { $set: { priceAmount: 95000 } },
    );

    await migration.up(connection);

    expect(await plans.countDocuments({})).toBe(13);
    // A long plan already there is never overwritten.
    expect(
      (
        await plans.findOne({
          key: 'starter',
          priceCurrency: 'XOF',
          interval: 'year',
        })
      )?.priceAmount,
    ).toBe(95000);
  });
});
