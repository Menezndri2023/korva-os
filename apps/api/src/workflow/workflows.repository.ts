import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Workflow, WorkflowDocument } from './schemas/workflow.schema';
import {
  WorkflowExecution,
  WorkflowExecutionDocument,
} from './schemas/workflow-execution.schema';
import {
  WorkflowActionClaim,
  WorkflowActionClaimDocument,
} from './schemas/workflow-action-claim.schema';

/**
 * 'claimed' carries the exact lease the caller now owns — required by markActionSucceeded/
 * markActionFailed's compare-and-swap filter (see LOT G4-POST-AUDIT/G4-FIX3): finalizing a claim
 * must prove the caller still holds the lease it was given, not just that it once held *a* lease
 * on this key. Passing that value back is what lets a stale caller's late finalize become a
 * verifiable no-op instead of silently touching whoever holds the claim now.
 */
export type ClaimActionResult =
  | { status: 'claimed'; leaseExpiresAt: Date }
  | { status: 'already-succeeded' }
  | { status: 'already-claimed' };

/**
 * How long a 'claimed' row stays ineligible for match-and-reuse by another claimAction call
 * (see WorkflowActionClaim#leaseExpiresAt). Only matters as a crash backstop — a holder that
 * finishes normally releases its lease immediately via markActionSucceeded/markActionFailed, so
 * a legitimate BullMQ retry (2s-30s exponential backoff, see EventBusService's JOB_OPTIONS) never
 * waits this out. Set well above BullMQ's default Worker lockDuration/stalledInterval (30s each,
 * unconfigured in EventsProcessor) so a lease can never expire while the original worker is still
 * legitimately holding its BullMQ job lock — only once that lock itself would already be
 * considered stalled.
 */
const ACTION_CLAIM_LEASE_MS = 60_000;

@Injectable()
export class WorkflowsRepository {
  constructor(
    @InjectModel(Workflow.name)
    private readonly workflowModel: Model<WorkflowDocument>,
    @InjectModel(WorkflowExecution.name)
    private readonly executionModel: Model<WorkflowExecutionDocument>,
    @InjectModel(WorkflowActionClaim.name)
    private readonly actionClaimModel: Model<WorkflowActionClaimDocument>,
  ) {}

  create(data: Partial<Workflow>): Promise<WorkflowDocument> {
    return this.workflowModel.create(data);
  }

  findById(
    organizationId: string,
    id: string,
  ): Promise<WorkflowDocument | null> {
    if (!Types.ObjectId.isValid(id)) return Promise.resolve(null);
    return this.workflowModel
      .findOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
  }

  findAll(organizationId: string): Promise<WorkflowDocument[]> {
    return this.workflowModel
      .find({ organizationId: new Types.ObjectId(organizationId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  /** All active workflows for an organization matching a given trigger — used by the engine. */
  findActiveByTrigger(
    organizationId: string,
    trigger: string,
  ): Promise<WorkflowDocument[]> {
    return this.workflowModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        trigger,
        active: true,
      })
      .exec();
  }

  async update(
    organizationId: string,
    id: string,
    data: Partial<Workflow>,
  ): Promise<WorkflowDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.workflowModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(id),
          organizationId: new Types.ObjectId(organizationId),
        },
        data,
        { new: true },
      )
      .exec();
  }

  async delete(organizationId: string, id: string): Promise<boolean> {
    if (!Types.ObjectId.isValid(id)) return false;
    const res = await this.workflowModel
      .deleteOne({
        _id: new Types.ObjectId(id),
        organizationId: new Types.ObjectId(organizationId),
      })
      .exec();
    return res.deletedCount > 0;
  }

  recordExecution(
    data: Partial<WorkflowExecution>,
  ): Promise<WorkflowExecutionDocument> {
    return this.executionModel.create(data);
  }

  findExecutions(
    organizationId: string,
    workflowId: string,
  ): Promise<WorkflowExecutionDocument[]> {
    return this.executionModel
      .find({
        organizationId: new Types.ObjectId(organizationId),
        workflowId: new Types.ObjectId(workflowId),
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Claim-first guard for one workflow action: atomically reserves (organizationId, workflowId,
   * actionIndex, eventKey) unless it's already 'succeeded' or currently leased by someone else.
   * Returns:
   *  - 'claimed' (with the lease just granted): either no matching document existed yet (fresh
   *    insert, arbitrated by the unique index below), or one existed with status 'claimed' and an
   *    *expired* lease — a re-claim, updated in place. Both cases never throw: an insert only
   *    collides with another insert (the unique-index race), and an in-place update only ever
   *    matches a row already ineligible for anyone else to also match (see leaseExpiresAt on the
   *    schema). The caller is cleared to run the action's effect, and must call
   *    markActionSucceeded/markActionFailed — passing back this exact leaseExpiresAt — when it's
   *    done, so the lease is released for the next legitimate attempt instead of sitting until it
   *    times out. That returned value is also this call's ownership proof: see
   *    markActionSucceeded/markActionFailed for why a stale caller can't use it to disturb
   *    whoever holds the claim by the time it gets around to finalizing (LOT G4-POST-AUDIT/
   *    G4-FIX3).
   *  - 'already-succeeded': a previous attempt already completed this exact action for this
   *    exact event. The caller must not repeat the effect.
   *  - 'already-claimed': the row is currently leased by someone else (either a genuine
   *    concurrent insert race, or an attempt to re-claim a lease that hasn't expired yet). The
   *    caller must not repeat the effect either, but this is distinct from 'already-succeeded'
   *    for observability.
   *
   * Concurrency proof (see LOT G4/G4-FIX2 audit): whatever a caller's own find phase observes,
   * MongoDB serializes writes to a single document, and only a row with status 'claimed' *and* an
   * expired lease matches this filter. A winner's write always sets leaseExpiresAt far into the
   * future, so every other caller racing on the same key — whether it started before or after the
   * winner's write commits — either finds nothing to match (attempts its own insert) or finds a
   * row with an unexpired lease (also falls through to attempting its own insert, since the
   * filter doesn't match). Either way every loser ends up on the insert path, which the unique
   * index arbitrates to exactly one winner regardless of how many callers race.
   */
  async claimAction(
    organizationId: string,
    workflowId: Types.ObjectId,
    actionIndex: number,
    eventKey: string,
  ): Promise<ClaimActionResult> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + ACTION_CLAIM_LEASE_MS);
    try {
      await this.actionClaimModel.findOneAndUpdate(
        {
          organizationId: new Types.ObjectId(organizationId),
          workflowId,
          actionIndex,
          eventKey,
          status: { $ne: 'succeeded' },
          // A row written before leaseExpiresAt existed has no such field at all — $lte alone
          // wouldn't match a missing field, which would leave it permanently un-reclaimable
          // (stuck matching neither branch, forever hitting the insert path's E11000 below) until
          // a manual data migration ran. $exists:false treats "no lease was ever recorded" the
          // same as "the lease has expired": both mean nothing is currently holding this claim.
          $or: [
            { leaseExpiresAt: { $exists: false } },
            { leaseExpiresAt: { $lte: now } },
          ],
        },
        { $set: { status: 'claimed', leaseExpiresAt } },
        { upsert: true },
      );
      return { status: 'claimed', leaseExpiresAt };
    } catch (error) {
      if (!isDuplicateActionClaimError(error)) throw error;
      // The filter above only attempts an insert when nothing matched it — no document existed
      // at all, the existing one is already 'succeeded', or its lease hasn't expired yet. So a
      // unique-index conflict here means one of two things, disambiguated by reading the row
      // back: someone else's write already landed 'succeeded' (completed the effect before we
      // even ran our filter), or someone else currently holds an active (or just-renewed) lease
      // on 'claimed'. Either way, we must not run the effect.
      const existing = await this.actionClaimModel.findOne({
        organizationId: new Types.ObjectId(organizationId),
        workflowId,
        actionIndex,
        eventKey,
      });
      return existing?.status === 'succeeded'
        ? { status: 'already-succeeded' }
        : { status: 'already-claimed' };
    }
  }

  /**
   * Finalizes a claim as 'succeeded' — but only if `ownedLeaseExpiresAt` (the exact value
   * claimAction returned to this caller) still matches the row's current lease. Returns whether
   * that was still true.
   *
   * This is the fix for the race LOT G4-POST-AUDIT found in G4-FIX2: a worker whose lease expired
   * (BullMQ considered it stalled, per Worker's default lockDuration/stalledInterval of 30s each)
   * can still be alive and finish *after* a second worker has already re-claimed the same action
   * with a new lease. Without the ownedLeaseExpiresAt filter below, the first (stale) worker's
   * finalize would match on business key alone and silently stamp 'succeeded' onto the row the
   * second worker now legitimately owns — corrupting its outcome without either worker knowing.
   * Filtering on the exact lease turns that stale write into a no-op: by the time the first worker
   * gets here, the row's leaseExpiresAt has already moved on to the second worker's value, so this
   * updateOne matches zero documents and changes nothing.
   *
   * A `false` return means exactly that: the effect this caller just ran is real (it can't be
   * un-run), but the bookkeeping for it couldn't be safely recorded because this caller is no
   * longer the row's owner — recording it anyway would silently corrupt whoever the current owner
   * is. The caller should log this as a rare stalled-worker condition, not retry or escalate: the
   * current owner's own finalize (success or failure) is what the row's state should reflect.
   */
  async markActionSucceeded(
    organizationId: string,
    workflowId: Types.ObjectId,
    actionIndex: number,
    eventKey: string,
    ownedLeaseExpiresAt: Date,
  ): Promise<boolean> {
    const result = await this.actionClaimModel.updateOne(
      {
        organizationId: new Types.ObjectId(organizationId),
        workflowId,
        actionIndex,
        eventKey,
        leaseExpiresAt: ownedLeaseExpiresAt,
      },
      { $set: { status: 'succeeded' } },
    );
    return result.matchedCount > 0;
  }

  /**
   * Releases a 'claimed' row's lease immediately after its effect failed, so the next claimAction
   * attempt — a genuine BullMQ retry, arriving after real backoff — can re-claim right away
   * instead of waiting out ACTION_CLAIM_LEASE_MS. Only takes effect if `ownedLeaseExpiresAt` (the
   * exact value claimAction returned to this caller) still matches the row's current lease —
   * exactly the same ownership proof and the same stale-worker rationale as markActionSucceeded
   * above, which this mirrors: a stale caller's release must never touch a lease someone else
   * currently holds (that would let a third worker claim and run the effect concurrently with the
   * second worker, the exact scenario LOT G4-POST-AUDIT demonstrated against the unguarded
   * version of this method). Returns whether the release actually applied.
   */
  async markActionFailed(
    organizationId: string,
    workflowId: Types.ObjectId,
    actionIndex: number,
    eventKey: string,
    ownedLeaseExpiresAt: Date,
  ): Promise<boolean> {
    const result = await this.actionClaimModel.updateOne(
      {
        organizationId: new Types.ObjectId(organizationId),
        workflowId,
        actionIndex,
        eventKey,
        leaseExpiresAt: ownedLeaseExpiresAt,
      },
      { $set: { leaseExpiresAt: new Date(0) } },
    );
    return result.matchedCount > 0;
  }
}

/**
 * True for the MongoDB duplicate-key error (code 11000) raised by the unique index on
 * (organizationId, workflowId, actionIndex, eventKey), mirroring isDuplicateIdempotencyKeyError
 * in PaymentsService — narrowed by index field name so an unrelated unique-index collision isn't
 * silently treated as a claim race.
 */
function isDuplicateActionClaimError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as Record<string, unknown>;
  return (
    code === 11000 && typeof message === 'string' && message.includes('eventKey')
  );
}
