import { Types } from 'mongoose';
import type { Model } from 'mongoose';
import { PaymentsRepository } from './payments.repository';
import type { PaymentDocument } from './schemas/payment.schema';
import type { RefundDocument } from './schemas/refund.schema';

/**
 * Stage 2.6 — this codebase has never had a dedicated PaymentsRepository unit test file (every
 * other repository method here is only ever exercised indirectly via e2e tests against real
 * Mongo). This file is deliberately narrow: it covers ONLY the methods Stage 2.6 touched or
 * added (findProcessingPayments' broadened filter, findIdByProviderReference), not a full audit
 * of every pre-existing method — see the Stage 2.6 final report for why a wider unit-test
 * migration was judged out of scope for this hardening lot.
 */

function makeQuery<T>(result: T) {
  const exec = jest.fn().mockResolvedValue(result);
  const query = { select: jest.fn(), limit: jest.fn(), exec };
  query.select.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  return query;
}

function buildRepository() {
  const paymentModel = {
    findOne: jest.fn(),
    find: jest.fn(),
  };
  const refundModel = {
    findOne: jest.fn(),
  };
  const repository = new PaymentsRepository(
    paymentModel as unknown as Model<PaymentDocument>,
    refundModel as unknown as Model<RefundDocument>,
  );
  return { repository, paymentModel, refundModel };
}

describe('PaymentsRepository — findProcessingPayments (Stage 2.6)', () => {
  it('queries BOTH pending and processing, not just processing — a Flutterwave-created Payment is always "pending" immediately after creation, and must not be invisible to reconciliation', async () => {
    const { repository, paymentModel } = buildRepository();
    const query = makeQuery([]);
    paymentModel.find.mockReturnValue(query);

    await repository.findProcessingPayments(50);

    expect(paymentModel.find).toHaveBeenCalledWith({
      status: { $in: ['pending', 'processing'] },
    });
    expect(query.limit).toHaveBeenCalledWith(50);
  });
});

describe('PaymentsRepository — findIdByProviderReference (Stage 2.6)', () => {
  it('returns { id, organizationId } for a matching Payment, projecting nothing else', async () => {
    const { repository, paymentModel } = buildRepository();
    const orgId = new Types.ObjectId();
    const paymentId = new Types.ObjectId();
    const query = makeQuery({ _id: paymentId, organizationId: orgId });
    paymentModel.findOne.mockReturnValue(query);

    const found = await repository.findIdByProviderReference(
      'flutterwave',
      'korva_inv_1_abc',
    );

    expect(paymentModel.findOne).toHaveBeenCalledWith({
      provider: 'flutterwave',
      providerReference: 'korva_inv_1_abc',
    });
    expect(found).toEqual({
      id: String(paymentId),
      organizationId: String(orgId),
    });
  });

  it('returns null when no matching Payment exists (e.g. the webhook arrived before checkout creation finished persisting the Payment)', async () => {
    const { repository, paymentModel } = buildRepository();
    const query = makeQuery(null);
    paymentModel.findOne.mockReturnValue(query);

    const found = await repository.findIdByProviderReference(
      'flutterwave',
      'korva_unknown_tx',
    );

    expect(found).toBeNull();
  });
});
