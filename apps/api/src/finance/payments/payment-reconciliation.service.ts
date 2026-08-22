import { Injectable, Logger } from '@nestjs/common';
import { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';

export interface ReconciliationSummary {
  processed: number;
  completed: number;
  failed: number;
  stillProcessing: number;
  unreconcilable: number;
}

/**
 * Sweeps Payments/Refunds stuck in 'processing' and asks the payment provider what actually
 * happened, then synchronizes MongoDB via the exact same guarded/transactional finalize paths
 * PaymentsService.create()/refund() already use (reconcileProcessingPayment/
 * reconcileProcessingRefund) — this service is purely an orchestrator over candidate-finding
 * and per-record delegation; it never performs a financial write itself, and never calls
 * PaymentProvider.createPayment()/refundPayment() (only the read-only status query methods).
 *
 * Triggered automatically by ReconciliationSchedulerService (a BullMQ repeatable job that calls
 * reconcilePendingPayments()/reconcilePendingRefunds() on an interval — see there for the
 * scheduling/multi-instance details), as well as being safe to call manually/from a test.
 */
@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  constructor(
    private readonly paymentsRepository: PaymentsRepository,
    private readonly paymentsService: PaymentsService,
  ) {}

  async reconcilePendingPayments(limit = 100): Promise<ReconciliationSummary> {
    const candidates =
      await this.paymentsRepository.findProcessingPayments(limit);
    const summary: ReconciliationSummary = {
      processed: 0,
      completed: 0,
      failed: 0,
      stillProcessing: 0,
      unreconcilable: 0,
    };

    for (const candidate of candidates) {
      summary.processed += 1;
      if (!candidate.providerReference) {
        summary.unreconcilable += 1;
        continue;
      }
      try {
        const reconciled =
          await this.paymentsService.reconcileProcessingPayment(
            candidate.organizationId.toString(),
            candidate.id as string,
          );
        this.tally(summary, reconciled.status);
      } catch (error) {
        // A single candidate failing (e.g. PAYMENT_NOT_FOUND from a race with something else
        // entirely) must never abort the rest of the sweep.
        this.logger.error(
          `Reconciliation sweep: failed on Payment ${candidate.id as string}`,
          error,
        );
        summary.stillProcessing += 1;
      }
    }

    return summary;
  }

  async reconcilePendingRefunds(limit = 100): Promise<ReconciliationSummary> {
    const candidates =
      await this.paymentsRepository.findProcessingRefunds(limit);
    const summary: ReconciliationSummary = {
      processed: 0,
      completed: 0,
      failed: 0,
      stillProcessing: 0,
      unreconcilable: 0,
    };

    for (const candidate of candidates) {
      summary.processed += 1;
      if (!candidate.providerReference) {
        summary.unreconcilable += 1;
        continue;
      }
      try {
        const reconciled = await this.paymentsService.reconcileProcessingRefund(
          candidate.organizationId.toString(),
          candidate.id as string,
        );
        this.tally(summary, reconciled.status);
      } catch (error) {
        this.logger.error(
          `Reconciliation sweep: failed on Refund ${candidate.id as string}`,
          error,
        );
        summary.stillProcessing += 1;
      }
    }

    return summary;
  }

  private tally(
    summary: ReconciliationSummary,
    status: string | undefined,
  ): void {
    if (status === 'completed') summary.completed += 1;
    else if (status === 'failed') summary.failed += 1;
    else summary.stillProcessing += 1;
  }
}
