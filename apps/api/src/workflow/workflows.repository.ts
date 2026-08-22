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

export type ClaimActionResult =
  | 'claimed'
  | 'already-succeeded'
  | 'already-claimed';

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
   * actionIndex, eventKey) unless it's already 'succeeded'. Returns:
   *  - 'claimed': no matching document existed yet, or one existed with status 'claimed' and got
   *    updated in place (a sequential retry after a prior attempt that never reached 'succeeded'
   *    — never throws, since updating an existing doc in-place never touches the unique index).
   *    The caller is cleared to run the action's effect.
   *  - 'already-succeeded': a previous attempt already completed this exact action for this
   *    exact event. The caller must not repeat the effect.
   *  - 'already-claimed': lost a genuine concurrent race to insert a brand-new claim (two callers
   *    reserving the same not-yet-existing key at the same instant — Mongo lets exactly one
   *    upsert insert and E11000s the other). Someone else is handling this right now; the caller
   *    must not repeat the effect either, but this is distinct from 'already-succeeded' for
   *    observability.
   */
  async claimAction(
    organizationId: string,
    workflowId: Types.ObjectId,
    actionIndex: number,
    eventKey: string,
  ): Promise<ClaimActionResult> {
    try {
      await this.actionClaimModel.findOneAndUpdate(
        {
          organizationId: new Types.ObjectId(organizationId),
          workflowId,
          actionIndex,
          eventKey,
          status: { $ne: 'succeeded' },
        },
        { $set: { status: 'claimed' } },
        { upsert: true },
      );
      return 'claimed';
    } catch (error) {
      if (!isDuplicateActionClaimError(error)) throw error;
      // The filter above only attempts an insert when nothing matched it — either no document
      // existed at all, or the only one existing is already 'succeeded'. So a unique-index
      // conflict here means one of two things, disambiguated by reading the row back: someone
      // else's upsert already wrote 'succeeded' (had already completed the effect before we
      // even ran the filter), or someone else's upsert won a concurrent insert race and left
      // it 'claimed' (in flight right now). Either way, we must not run the effect.
      const existing = await this.actionClaimModel.findOne({
        organizationId: new Types.ObjectId(organizationId),
        workflowId,
        actionIndex,
        eventKey,
      });
      return existing?.status === 'succeeded'
        ? 'already-succeeded'
        : 'already-claimed';
    }
  }

  async markActionSucceeded(
    organizationId: string,
    workflowId: Types.ObjectId,
    actionIndex: number,
    eventKey: string,
  ): Promise<void> {
    await this.actionClaimModel.updateOne(
      {
        organizationId: new Types.ObjectId(organizationId),
        workflowId,
        actionIndex,
        eventKey,
      },
      { $set: { status: 'succeeded' } },
    );
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
