import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WorkflowActionClaimDocument = HydratedDocument<WorkflowActionClaim>;

export const WORKFLOW_ACTION_CLAIM_STATUSES = ['claimed', 'succeeded'] as const;
export type WorkflowActionClaimStatus =
  (typeof WORKFLOW_ACTION_CLAIM_STATUSES)[number];

/**
 * One row per (workflow, action position, event) — the claim-first guard that makes a BullMQ
 * retry of the 'events' queue safe. Inserted BEFORE an action's effect runs (see
 * WorkflowActionsService.execute), not after like WorkflowExecution — it's a concurrency gate,
 * not a log. Mirrors the (organizationId, idempotencyKey) unique-index claim pattern used by
 * Payment/Refund, with one deliberate difference: a claim that never reaches 'succeeded' stays
 * re-claimable (no terminal 'failed' state) — unlike a client-facing Idempotency-Key, a BullMQ
 * retry of the same event IS the legitimate next attempt, so it must be able to re-claim and
 * actually retry the effect, not just replay a frozen failure.
 *
 * `leaseExpiresAt` is what makes that re-claimability safe under real concurrency (see LOT
 * G4/G4-FIX2 audit): a 'claimed' row is only eligible to be matched-and-reused by
 * WorkflowsRepository.claimAction while its lease is in the past. A holder that finishes (success
 * or failure) releases the lease explicitly (markActionSucceeded / markActionFailed); one that
 * crashes without releasing is only reclaimable once the lease naturally times out. Either way,
 * a fresh concurrent claimAction call arriving while the lease is still active can never match
 * the row — it falls through to the same insert-vs-unique-index path as a brand new claim, so the
 * index is what arbitrates every genuine race, at any concurrency level.
 */
@Schema({ timestamps: true, collection: 'workflow_action_claims' })
export class WorkflowActionClaim {
  @Prop({
    type: Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true,
  })
  organizationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Workflow', required: true })
  workflowId!: Types.ObjectId;

  @Prop({ required: true })
  actionIndex!: number;

  /** `${eventName}:${entityId}` — see EventBusService.publish(). */
  @Prop({ required: true })
  eventKey!: string;

  @Prop({
    type: String,
    enum: WORKFLOW_ACTION_CLAIM_STATUSES,
    required: true,
    default: 'claimed',
  })
  status!: WorkflowActionClaimStatus;

  /**
   * When this claim stops being eligible for match-and-reuse by a concurrent/later claimAction
   * call. Set to now + the lease duration on every successful claim (initial or re-claim); reset
   * into the past by markActionSucceeded/markActionFailed to release it immediately. Not part of
   * the unique index — it's a filter condition on claimAction's update, not an identity field.
   */
  @Prop({ type: Date, required: true })
  leaseExpiresAt!: Date;
}

export const WorkflowActionClaimSchema =
  SchemaFactory.createForClass(WorkflowActionClaim);
WorkflowActionClaimSchema.index(
  { organizationId: 1, workflowId: 1, actionIndex: 1, eventKey: 1 },
  { unique: true },
);
