import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
  /** Stage 2.5 — resolved (or not) by the caller BEFORE claimIfNew ever runs; see
   *  IntegrationWebhookService.process's own doc comment. `null`/omitted persists as an explicit
   *  unresolved attribution, never guessed here. Ignored entirely on a losing (duplicate) claim —
   *  only the delivery that actually wins the insert can set this, which is exactly what makes a
   *  duplicate/replayed delivery keep the original's tenant attribution for free. */
  organizationId?: string | null;
}

export interface ClaimIntegrationWebhookEventResult {
  /** true only for the delivery that actually won the insert — see claimIfNew's own doc comment. */
  inserted: boolean;
  event: IntegrationWebhookEventDocument | null;
}

/**
 * Stage 2.8 — deliberately secret-free: never `payload` (the raw, already-verified provider
 * body — see IntegrationWebhookEvent.payload's own doc comment on why it's kept verbatim for
 * audit but "never logged"; this ops summary applies the same rule), never anything beyond what
 * this interface declares. `id` is the document's own Mongo id, not a provider-issued identifier.
 */
export interface UnresolvedWebhookEventSummary {
  id: string;
  provider: string;
  domain: IntegrationWebhookEventDomain;
  providerEventId: string;
  receivedAt: Date;
}

export interface FindUnresolvedEventsInput {
  page: number;
  limit: number;
  provider?: string;
  domain?: IntegrationWebhookEventDomain;
}

export interface FindUnresolvedEventsResult {
  data: UnresolvedWebhookEventSummary[];
  total: number;
  page: number;
  limit: number;
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
          organizationId: input.organizationId
            ? new Types.ObjectId(input.organizationId)
            : null,
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

  /**
   * Stage 2.8 — operational observability. Lists webhook deliveries that were cryptographically
   * valid (they passed `claimIfNew` and were persisted) but whose tenant could not be resolved
   * (`organizationId: null`, see that field's own doc comment — Stage 2.5's own explicit
   * fail-closed state). Never returns `payload` (see UnresolvedWebhookEventSummary's own doc
   * comment) or any other field beyond that interface — an operator diagnosing an unresolved
   * delivery gets enough to go find the real payload directly in Mongo (by `id`) under proper
   * access controls, not a copy of it flowing through this summary. Paginated and sorted by
   * `receivedAt` descending (most recent first) via the `{organizationId:1, receivedAt:-1}`
   * index (see the schema's own comment on that index) — never an unbounded scan.
   */
  async findUnresolvedEvents(
    input: FindUnresolvedEventsInput,
  ): Promise<FindUnresolvedEventsResult> {
    const filter: Record<string, unknown> = { organizationId: null };
    if (input.provider) filter.provider = input.provider;
    if (input.domain) filter.domain = input.domain;

    const [docs, total] = await Promise.all([
      this.model
        .find(filter)
        .select('provider providerEventId domain receivedAt')
        .sort({ receivedAt: -1 })
        .skip((input.page - 1) * input.limit)
        .limit(input.limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return {
      data: docs.map((doc) => ({
        id: String(doc._id),
        provider: doc.provider,
        domain: doc.domain,
        providerEventId: doc.providerEventId,
        receivedAt: doc.receivedAt,
      })),
      total,
      page: input.page,
      limit: input.limit,
    };
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
