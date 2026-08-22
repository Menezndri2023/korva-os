import { Injectable, Logger } from '@nestjs/common';
import type { WorkflowAction } from '@korva/types';
import { WorkflowsRepository } from './workflows.repository';
import { WorkflowActionsService } from './workflow-actions.service';
import { evaluateConditions } from './conditions';
import type { WorkflowDocument } from './schemas/workflow.schema';

@Injectable()
export class WorkflowEngineService {
  private readonly logger = new Logger(WorkflowEngineService.name);

  constructor(
    private readonly workflowsRepository: WorkflowsRepository,
    private readonly workflowActionsService: WorkflowActionsService,
  ) {}

  /** Entry point called by the events queue processor for every published event. */
  async handleEvent(
    organizationId: string,
    eventName: string,
    payload: Record<string, unknown>,
    eventKey?: string,
  ): Promise<void> {
    const workflows = await this.workflowsRepository.findActiveByTrigger(
      organizationId,
      eventName,
    );

    // Every matching workflow always gets a pass on every attempt, regardless of whether an
    // earlier one in the same pass hit a retryable action failure — a job-level retry (thrown
    // below) must not starve workflow #2 just because workflow #1's create_task failed. Each
    // run's own errors are collected here and only re-thrown, as one aggregate error, after
    // every workflow has been attempted — so BullMQ still sees this job as failed (and retries
    // it) without any workflow's execution log going unrecorded for this pass.
    const retryableFailures: unknown[] = [];
    for (const workflow of workflows) {
      try {
        await this.runWorkflow(workflow, payload, eventKey);
      } catch (error) {
        retryableFailures.push(error);
      }
    }

    if (retryableFailures.length > 0) {
      throw new Error(
        `${retryableFailures.length} workflow(s) had a retryable action failure for event "${eventName}"`,
        { cause: retryableFailures[0] },
      );
    }
  }

  private async runWorkflow(
    workflow: WorkflowDocument,
    payload: Record<string, unknown>,
    eventKey?: string,
  ): Promise<void> {
    if (!evaluateConditions(workflow.conditions, payload)) return;

    const organizationId = workflow.organizationId.toString();
    // The stored (type, config) pairing was already validated by Zod at workflow
    // creation/update time — safe to trust the shape here when reading it back.
    const actionResults = await Promise.all(
      workflow.actions.map((action, actionIndex) =>
        this.workflowActionsService.execute(
          organizationId,
          action as unknown as WorkflowAction,
          payload,
          eventKey
            ? { workflowId: workflow._id, actionIndex, eventKey }
            : undefined,
        ),
      ),
    );
    const failed = actionResults.filter((result) => !result.success);
    const retryable = actionResults.some(
      (result) => !result.success && result.retryable,
    );

    await this.workflowsRepository.recordExecution({
      organizationId: workflow.organizationId,
      workflowId: workflow._id,
      eventName: workflow.trigger,
      payload,
      status: failed.length === 0 ? 'success' : 'failed',
      actionResults,
      error:
        failed.length > 0 ? failed.map((f) => f.error).join('; ') : undefined,
    });

    if (failed.length > 0) {
      this.logger.warn(
        `Workflow "${workflow.name}" (${workflow.id as string}) had ${failed.length} failed action(s)`,
      );
    }

    // Thrown only after recordExecution above, so the log always reflects this attempt even
    // when the job goes on to be retried by BullMQ (see handleEvent).
    if (retryable) {
      throw new Error(
        `Workflow "${workflow.name}" (${workflow.id as string}) has a retryable action failure`,
      );
    }
  }
}
