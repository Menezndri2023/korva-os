import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import {
  DEFAULT_SETTLEMENT_COMMISSION_BASIS_POINTS,
  SettlementService,
} from './settlement.service';
import type { SettlementRepository } from './settlement.repository';
import type { SettlementDocument } from './schemas/settlement.schema';

type SettlementRepositoryMock = jest.Mocked<
  Pick<SettlementRepository, 'create' | 'findById' | 'findAll' | 'markSettled'>
>;

function buildRepositoryMock(): SettlementRepositoryMock {
  return {
    create: jest.fn(),
    findById: jest.fn(),
    findAll: jest.fn(),
    markSettled: jest.fn(),
  };
}

/**
 * The mock above is intentionally typed as `Pick<SettlementRepository, ...>` (not
 * `SettlementRepository` itself) so assertions like `expect(repository.create).toHaveBeenCalled*`
 * below don't trip @typescript-eslint/unbound-method (a false positive on class-instance method
 * types) — same pattern as password-reset.service.spec.ts. This narrow cast is the one place that
 * bridges back to the real constructor parameter type.
 */
function asRepository(mock: SettlementRepositoryMock): SettlementRepository {
  return mock as unknown as SettlementRepository;
}

describe('SettlementService', () => {
  describe('computeCommission', () => {
    it('splits a round amount at the default 10% (1000bps) rate with no remainder', () => {
      const service = new SettlementService(
        asRepository(buildRepositoryMock()),
      );

      const result = service.computeCommission({
        grossAmount: 10_000,
        currency: 'XOF',
      });

      expect(result).toEqual({ commissionAmount: 1_000, tenantAmount: 9_000 });
      expect(result.commissionAmount + result.tenantAmount).toBe(10_000);
    });

    it('uses an injected commission rate instead of the default when provided', () => {
      const service = new SettlementService(
        asRepository(buildRepositoryMock()),
        2_500,
      ); // 25.00%

      const result = service.computeCommission({
        grossAmount: 4_000,
        currency: 'XOF',
      });

      expect(result).toEqual({ commissionAmount: 1_000, tenantAmount: 3_000 });
    });

    it('rounds a fractional-minor-unit commission and still balances exactly for one hand-picked awkward amount', () => {
      // 333 * 10% = 33.3 minor units — not integral. A naive per-side rounding of both halves
      // independently could produce 33 + 30 = 63 !== 33 style drift; this proves the actual
      // implementation doesn't.
      const service = new SettlementService(
        asRepository(buildRepositoryMock()),
      );

      const result = service.computeCommission({
        grossAmount: 333,
        currency: 'XOF',
      });

      expect(result.commissionAmount + result.tenantAmount).toBe(333);
      expect(Number.isInteger(result.commissionAmount)).toBe(true);
      expect(Number.isInteger(result.tenantAmount)).toBe(true);
    });

    it('property-style invariant: commissionAmount + tenantAmount === grossAmount for every integer amount in a wide range, across several rates', () => {
      const rates = [1, 7, 33, 100, 1000, 1234, 2500, 5000, 9999];
      let amountsTested = 0;

      for (const rate of rates) {
        const service = new SettlementService(
          asRepository(buildRepositoryMock()),
          rate,
        );
        // Sweep every gross amount from 0 to 5000 minor units — deliberately including many
        // amounts that don't divide evenly by the rate, which is exactly where a naive
        // percentage split would lose or duplicate a minor unit.
        for (let grossAmount = 0; grossAmount <= 5_000; grossAmount++) {
          const { commissionAmount, tenantAmount } = service.computeCommission({
            grossAmount,
            currency: 'XOF',
          });
          expect(commissionAmount + tenantAmount).toBe(grossAmount);
          expect(Number.isInteger(commissionAmount)).toBe(true);
          expect(Number.isInteger(tenantAmount)).toBe(true);
          expect(commissionAmount).toBeGreaterThanOrEqual(0);
          expect(tenantAmount).toBeGreaterThanOrEqual(0);
          amountsTested++;
        }
      }

      // 9 rates * 5001 amounts each.
      expect(amountsTested).toBe(9 * 5_001);
    });

    it('handles a zero gross amount', () => {
      const service = new SettlementService(
        asRepository(buildRepositoryMock()),
      );
      const result = service.computeCommission({
        grossAmount: 0,
        currency: 'XOF',
      });
      expect(result).toEqual({ commissionAmount: 0, tenantAmount: 0 });
    });

    it('defaults to DEFAULT_SETTLEMENT_COMMISSION_BASIS_POINTS when no rate is injected', () => {
      const service = new SettlementService(
        asRepository(buildRepositoryMock()),
      );
      const result = service.computeCommission({
        grossAmount: 10_000,
        currency: 'XOF',
      });
      expect(result.commissionAmount).toBe(
        Math.round(
          (10_000 * DEFAULT_SETTLEMENT_COMMISSION_BASIS_POINTS) / 10_000,
        ),
      );
    });
  });

  describe('createSettlement', () => {
    it('persists a settlement in pending status with the correct computed split', async () => {
      const repository = buildRepositoryMock();
      const organizationId = new Types.ObjectId().toString();
      const paymentId = new Types.ObjectId().toString();
      repository.create.mockImplementation((data) =>
        Promise.resolve({
          ...data,
          id: 'new-id',
        } as unknown as SettlementDocument),
      );
      const service = new SettlementService(asRepository(repository));

      const settlement = await service.createSettlement({
        organizationId,
        paymentId,
        grossAmount: 10_000,
        currency: 'XOF',
      });

      expect(repository.create).toHaveBeenCalledTimes(1);
      const [persisted] = repository.create.mock.calls[0]!;
      expect(persisted.status).toBe('pending');
      expect(persisted.grossAmount).toBe(10_000);
      expect(persisted.currency).toBe('XOF');
      expect(persisted.commissionAmount).toBe(1_000);
      expect(persisted.tenantAmount).toBe(9_000);
      expect(persisted.commissionRateBasisPoints).toBe(
        DEFAULT_SETTLEMENT_COMMISSION_BASIS_POINTS,
      );
      expect((persisted.organizationId as Types.ObjectId).toString()).toBe(
        organizationId,
      );
      expect((persisted.paymentId as Types.ObjectId).toString()).toBe(
        paymentId,
      );
      expect(settlement.status).toBe('pending');
    });
  });

  describe('markSettled', () => {
    it('transitions status to settled when the organizationId matches', async () => {
      const repository = buildRepositoryMock();
      const settled = {
        id: 'settlement-1',
        status: 'settled',
      } as unknown as SettlementDocument;
      repository.markSettled.mockResolvedValue(settled);
      const service = new SettlementService(asRepository(repository));

      const result = await service.markSettled('settlement-1', 'org-1');

      expect(repository.markSettled).toHaveBeenCalledWith(
        'org-1',
        'settlement-1',
        expect.any(Date),
      );
      expect(result.status).toBe('settled');
    });

    it('rejects (throws NotFoundException) when the settlement belongs to a different organizationId', async () => {
      const repository = buildRepositoryMock();
      // Repository is the tenant-isolation boundary: its filter simply doesn't match a foreign
      // organizationId, so it resolves null exactly as it does for a nonexistent id — this proves
      // the service surfaces that as a clean 404, never a silent success or a leak of the other
      // tenant's record.
      repository.markSettled.mockResolvedValue(null);
      const service = new SettlementService(asRepository(repository));

      await expect(
        service.markSettled('settlement-1', 'wrong-org'),
      ).rejects.toThrow(NotFoundException);
      expect(repository.markSettled).toHaveBeenCalledWith(
        'wrong-org',
        'settlement-1',
        expect.any(Date),
      );
    });
  });
});
