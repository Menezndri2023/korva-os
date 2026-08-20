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
  ): Promise<void> {
    const workflows = await this.workflowsRepository.findActiveByTrigger(
      organizationId,
      eventName,
    );
    for (const workflow of workflows) {
      await this.runWorkflow(workflow, payload);
    }
  }

  private async runWorkflow(
    workflow: WorkflowDocument,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!evaluateConditions(workflow.conditions, payload)) return;

    const organizationId = workflow.organizationId.toString();
    // The stored (type, config) pairing was already validated by Zod at workflow
    // creation/update time — safe to trust the shape here when reading it back.
    const actionResults = await Promise.all(
      workflow.actions.map((action) =>
        this.workflowActionsService.execute(
          organizationId,
          action as unknown as WorkflowAction,
          payload,
        ),
      ),
    );
    const failed = actionResults.filter((result) => !result.success);

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
  }
}
