import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { SettlementRepository } from './settlement.repository';
import { SettlementDocument } from './schemas/settlement.schema';

/**
 * DI token for overriding the commission rate applied by SettlementService, in basis points
 * (1/100th of a percent — e.g. 1000 = 10.00%). Not bound anywhere yet (no module registers this
 * provider in Stage 1) — see DEFAULT_SETTLEMENT_COMMISSION_BASIS_POINTS below.
 */
export const SETTLEMENT_COMMISSION_BASIS_POINTS =
  'SETTLEMENT_COMMISSION_BASIS_POINTS';

/**
 * Stage-1 scaffolding placeholder ONLY. No business decision has been made about what KORVA's
 * actual commission on Flow B (Merchant of Record) payments should be — this number exists so
 * SettlementService is exercisable and testable in isolation before that decision lands. It is
 * deliberately expressed as an explicit, named, easily-overridden constant (basis points, not a
 * magic float) so a real figure can replace it later — via SETTLEMENT_COMMISSION_BASIS_POINTS
 * constructor injection or config — without touching this service's logic. DO NOT read "1000"
 * (10.00%) as a decided rate.
 */
export const DEFAULT_SETTLEMENT_COMMISSION_BASIS_POINTS = 1000;

export interface ComputeCommissionInput {
  grossAmount: number;
  currency: string;
}

export interface ComputeCommissionResult {
  commissionAmount: number;
  tenantAmount: number;
}

export interface CreateSettlementInput {
  organizationId: string;
  paymentId: string;
  grossAmount: number;
  currency: string;
}

/**
 * Domain logic for Flow B split settlement (KORVA is Merchant of Record — see
 * docs/architecture/integrations-platform.md §1 decision #2 and §4 "Split settlement"). Pure
 * domain logic + persistence only: this service deliberately never calls any PaymentProvider,
 * HTTP client, or external service — "SettlementService calls the adapter, not the other way
 * around" (§4), and no adapter exists yet in Stage 1. It is not triggered by any real payment
 * event; callers pass a payment amount/currency/organizationId directly, which is what keeps it
 * fully testable in isolation ahead of Stage 2's real PSP integration.
 */
@Injectable()
export class SettlementService {
  private readonly commissionRateBasisPoints: number;

  constructor(
    private readonly settlementRepository: SettlementRepository,
    @Optional()
    @Inject(SETTLEMENT_COMMISSION_BASIS_POINTS)
    commissionRateBasisPoints?: number,
  ) {
    this.commissionRateBasisPoints =
      commissionRateBasisPoints ?? DEFAULT_SETTLEMENT_COMMISSION_BASIS_POINTS;
  }

  /**
   * Splits a gross (integer minor-unit) amount into KORVA's commission and the tenant's payable
   * share. Rounds the commission to the nearest minor unit and derives tenantAmount as the exact
   * remainder (`grossAmount - commissionAmount`) rather than independently rounding both halves —
   * this is what guarantees `commissionAmount + tenantAmount === grossAmount` exactly, for every
   * gross amount and every rate, with no lost or duplicated cent from rounding twice.
   */
  computeCommission(input: ComputeCommissionInput): ComputeCommissionResult {
    const commissionAmount = Math.round(
      (input.grossAmount * this.commissionRateBasisPoints) / 10_000,
    );
    const tenantAmount = input.grossAmount - commissionAmount;
    return { commissionAmount, tenantAmount };
  }

  /** Persists a new settlement record in `status: 'pending'`, with the computed split. */
  async createSettlement(
    input: CreateSettlementInput,
  ): Promise<SettlementDocument> {
    const { commissionAmount, tenantAmount } = this.computeCommission(input);
    return this.settlementRepository.create({
      organizationId: new Types.ObjectId(input.organizationId),
      paymentId: new Types.ObjectId(input.paymentId),
      grossAmount: input.grossAmount,
      currency: input.currency,
      commissionRateBasisPoints: this.commissionRateBasisPoints,
      commissionAmount,
      tenantAmount,
      status: 'pending',
    });
  }

  /**
   * Transitions a settlement to `status: 'settled'`. organizationId-checked — rejects (404, same
   * as every other tenant-scoped lookup in this codebase, e.g. PaymentsService) if the settlement
   * doesn't belong to that organization, never leaking whether a foreign id exists.
   *
   * Stage 2 extension point: this is where a real adapter would eventually call the PSP's actual
   * payout/split API (per docs/architecture/integrations-platform.md §4's (a)/(b) split
   * mechanisms) BEFORE marking the record settled. No such call exists here — no PSP adapter
   * exists yet in Stage 1, and this service must not call one (see class doc comment).
   */
  async markSettled(
    settlementId: string,
    organizationId: string,
  ): Promise<SettlementDocument> {
    const settled = await this.settlementRepository.markSettled(
      organizationId,
      settlementId,
      new Date(),
    );
    if (!settled) {
      throw new NotFoundException({
        code: 'SETTLEMENT_NOT_FOUND',
        message: 'Settlement not found',
      });
    }
    return settled;
  }
}
