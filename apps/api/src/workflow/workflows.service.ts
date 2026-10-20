import { Injectable, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type {
  CreateWorkflowInput,
  TestWorkflowInput,
  UpdateWorkflowInput,
} from '@korva/validation';
import type { WorkflowCondition } from '@korva/types';
import { WorkflowsRepository } from './workflows.repository';
import { WorkflowDocument } from './schemas/workflow.schema';
import { WorkflowExecutionDocument } from './schemas/workflow-execution.schema';
import { evaluateConditions } from './conditions';
import { EntitlementsService } from '../subscriptions/entitlements.service';

export interface TestWorkflowResult {
  matched: boolean;
  conditionResults: {
    field: string;
    operator: string;
    value: unknown;
    passed: boolean;
  }[];
}

@Injectable()
export class WorkflowsService {
  constructor(
    private readonly workflowsRepository: WorkflowsRepository,
    private readonly entitlementsService: EntitlementsService,
  ) {}

  async create(
    organizationId: string,
    input: CreateWorkflowInput,
  ): Promise<WorkflowDocument> {
    await this.entitlementsService.assertCountWithinLimit(
      organizationId,
      'workflows',
    );
    return this.workflowsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      name: input.name,
      trigger: input.trigger,
      active: input.active,
      conditions: input.conditions,
      actions: input.actions,
    });
  }

  list(organizationId: string): Promise<WorkflowDocument[]> {
    return this.workflowsRepository.findAll(organizationId);
  }

  async getById(organizationId: string, id: string): Promise<WorkflowDocument> {
    const workflow = await this.workflowsRepository.findById(
      organizationId,
      id,
    );
    if (!workflow) {
      throw new NotFoundException({
        code: 'WORKFLOW_NOT_FOUND',
        message: 'Workflow not found',
      });
    }
    return workflow;
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateWorkflowInput,
  ): Promise<WorkflowDocument> {
    const updated = await this.workflowsRepository.update(
      organizationId,
      id,
      input,
    );
    if (!updated) {
      throw new NotFoundException({
        code: 'WORKFLOW_NOT_FOUND',
        message: 'Workflow not found',
      });
    }
    return updated;
  }

  async delete(organizationId: string, id: string): Promise<void> {
    const deleted = await this.workflowsRepository.delete(organizationId, id);
    if (!deleted) {
      throw new NotFoundException({
        code: 'WORKFLOW_NOT_FOUND',
        message: 'Workflow not found',
      });
    }
  }

  listExecutions(
    organizationId: string,
    workflowId: string,
  ): Promise<WorkflowExecutionDocument[]> {
    return this.workflowsRepository.findExecutions(organizationId, workflowId);
  }

  /** Dry run: evaluates conditions against a sample payload without executing any action. */
  async test(
    organizationId: string,
    id: string,
    input: TestWorkflowInput,
  ): Promise<TestWorkflowResult> {
    const workflow = await this.getById(organizationId, id);
    const conditionResults = workflow.conditions.map(
      (condition: WorkflowCondition) => ({
        field: condition.field,
        operator: condition.operator,
        value: condition.value,
        passed: evaluateConditions([condition], input.payload),
      }),
    );

    return {
      matched: evaluateConditions(workflow.conditions, input.payload),
      conditionResults,
    };
  }
}
