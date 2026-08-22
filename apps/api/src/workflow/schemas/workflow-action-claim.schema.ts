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
}

export const WorkflowActionClaimSchema =
  SchemaFactory.createForClass(WorkflowActionClaim);
WorkflowActionClaimSchema.index(
  { organizationId: 1, workflowId: 1, actionIndex: 1, eventKey: 1 },
  { unique: true },
);
