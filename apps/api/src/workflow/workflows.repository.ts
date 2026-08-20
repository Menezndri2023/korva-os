import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Workflow, WorkflowDocument } from './schemas/workflow.schema';
import {
  WorkflowExecution,
  WorkflowExecutionDocument,
} from './schemas/workflow-execution.schema';

@Injectable()
export class WorkflowsRepository {
  constructor(
    @InjectModel(Workflow.name)
    private readonly workflowModel: Model<WorkflowDocument>,
    @InjectModel(WorkflowExecution.name)
    private readonly executionModel: Model<WorkflowExecutionDocument>,
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
}
