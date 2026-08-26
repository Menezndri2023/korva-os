import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IntegrationWebhookEvent,
  IntegrationWebhookEventDocument,
  IntegrationWebhookEventDomain,
} from './schemas/integration-webhook-event.schema';

export interface ClaimIntegrationWebhookEventInput {
  provider: string;
  providerEventId: string;
  domain: IntegrationWebhookEventDomain;
  payload: Record<string, unknown>;
}

export interface ClaimIntegrationWebhookEventResult {
  /** true only for the delivery that actually won the insert — see claimIfNew's own doc comment. */
  inserted: boolean;
  event: IntegrationWebhookEventDocument | null;
}

@Injectable()
export class IntegrationWebhookRepository {
  constructor(
    @InjectModel(IntegrationWebhookEvent.name)
    private readonly model: Model<IntegrationWebhookEventDocument>,
  ) {}

  /**
   * Atomic insert-if-not-exists. The ONLY thing that arbitrates two concurrent deliveries of the
   * same (provider, providerEventId) is the unique index on IntegrationWebhookEventSchema — this
   * is a single `create()` call, never a read-then-write (a read-then-write leaves a race window
   * where two concurrent deliveries both observe "not found" and both insert; a unique index
   * makes MongoDB itself the sole arbiter, so at most one of two concurrent inserts can ever
   * succeed no matter how they interleave). A losing insert raises MongoDB's duplicate-key error
   * (E11000), caught below and reported as `{ inserted: false }` rather than thrown — this
   * mirrors PaymentsRepository/PaymentsService's own (organizationId, idempotencyKey) claim
   * pattern (see payments.service.ts's isDuplicateIdempotencyKeyError /
   * isDuplicateWebhookEventError below).
   */
  async claimIfNew(
    input: ClaimIntegrationWebhookEventInput,
  ): Promise<ClaimIntegrationWebhookEventResult> {
    try {
      const [event] = await this.model.create([
        {
          provider: input.provider,
          providerEventId: input.providerEventId,
          domain: input.domain,
          payload: input.payload,
          receivedAt: new Date(),
        },
      ]);
      return { inserted: true, event: event ?? null };
    } catch (error) {
      if (isDuplicateWebhookEventError(error)) {
        return { inserted: false, event: null };
      }
      throw error;
    }
  }
}

/**
 * True for the MongoDB duplicate-key error (code 11000) raised by the unique index on
 * (provider, providerEventId) — narrowed by index field name in the driver's error message,
 * mirroring isDuplicateIdempotencyKeyError in payments.service.ts and isDuplicateOrderIdError in
 * orders.service.ts, so an unrelated unique-index collision on this collection is never silently
 * swallowed as an idempotency race.
 */
function isDuplicateWebhookEventError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as Record<string, unknown>;
  return (
    code === 11000 &&
    typeof message === 'string' &&
    message.includes('providerEventId')
  );
}
