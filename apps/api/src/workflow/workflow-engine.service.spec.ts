import { Types } from 'mongoose';
import { WorkflowEngineService } from './workflow-engine.service';
import type { WorkflowsRepository } from './workflows.repository';
import type { WorkflowActionsService } from './workflow-actions.service';
import type { WorkflowDocument } from './schemas/workflow.schema';

function buildWorkflow(overrides: Partial<WorkflowDocument> = {}) {
  return {
    _id: new Types.ObjectId(),
    id: new Types.ObjectId().toString(),
    organizationId: new Types.ObjectId(),
    name: 'Test workflow',
    trigger: 'lead.created',
    active: true,
    conditions: [],
    actions: [{ type: 'create_task', config: { title: 'Task' } }],
    ...overrides,
  } as unknown as WorkflowDocument;
}

describe('WorkflowEngineService — retry propagation and execution logging', () => {
  it('records an execution and does not throw when every action succeeds', async () => {
    const workflow = buildWorkflow();
    const recordExecution = jest.fn().mockResolvedValue(undefined);
    const repository = {
      findActiveByTrigger: jest.fn().mockResolvedValue([workflow]),
      recordExecution,
    } as unknown as WorkflowsRepository;
    const actionsService = {
      execute: jest.fn().mockResolvedValue({ type: 'create_task', success: true }),
    } as unknown as WorkflowActionsService;

    const engine = new WorkflowEngineService(repository, actionsService);

    await expect(
      engine.handleEvent('org-1', 'lead.created', { leadId: 'lead-1' }, 'lead.created:lead-1'),
    ).resolves.toBeUndefined();
    expect(recordExecution).toHaveBeenCalledTimes(1);
    expect(recordExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'success' }),
    );
  });

  it('still records the execution log, then throws, when a retryable action fails', async () => {
    const workflow = buildWorkflow();
    const recordExecution = jest.fn().mockResolvedValue(undefined);
    const repository = {
      findActiveByTrigger: jest.fn().mockResolvedValue([workflow]),
      recordExecution,
    } as unknown as WorkflowsRepository;
    const actionsService = {
      execute: jest.fn().mockResolvedValue({
        type: 'create_task',
        success: false,
        error: 'Mongo unreachable',
        retryable: true,
      }),
    } as unknown as WorkflowActionsService;

    const engine = new WorkflowEngineService(repository, actionsService);

    await expect(
      engine.handleEvent('org-1', 'lead.created', { leadId: 'lead-1' }, 'lead.created:lead-1'),
    ).rejects.toThrow();
    // The log for this attempt must exist regardless of the eventual job-level retry.
    expect(recordExecution).toHaveBeenCalledTimes(1);
    expect(recordExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('never throws for a non-retryable action failure (send_email/webhook)', async () => {
    const workflow = buildWorkflow({
      actions: [{ type: 'send_email', config: { to: 'a@b.com', subject: 's', body: 'b' } }],
    } as Partial<WorkflowDocument>);
    const recordExecution = jest.fn().mockResolvedValue(undefined);
    const repository = {
      findActiveByTrigger: jest.fn().mockResolvedValue([workflow]),
      recordExecution,
    } as unknown as WorkflowsRepository;
    const actionsService = {
      execute: jest.fn().mockResolvedValue({
        type: 'send_email',
        success: false,
        error: 'Provider down',
        retryable: false,
      }),
    } as unknown as WorkflowActionsService;

    const engine = new WorkflowEngineService(repository, actionsService);

    await expect(
      engine.handleEvent('org-1', 'lead.created', {}, 'lead.created:lead-1'),
    ).resolves.toBeUndefined();
    expect(recordExecution).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'failed' }),
    );
  });

  it('runs every matching workflow even when an earlier one has a retryable failure, and reports only once', async () => {
    const failingWorkflow = buildWorkflow({ name: 'Failing' } as Partial<WorkflowDocument>);
    const healthyWorkflow = buildWorkflow({ name: 'Healthy' } as Partial<WorkflowDocument>);
    const recordExecution = jest.fn().mockResolvedValue(undefined);
    const repository = {
      findActiveByTrigger: jest.fn().mockResolvedValue([failingWorkflow, healthyWorkflow]),
      recordExecution,
    } as unknown as WorkflowsRepository;
    const execute = jest
      .fn()
      .mockResolvedValueOnce({
        type: 'create_task',
        success: false,
        error: 'boom',
        retryable: true,
      })
      .mockResolvedValueOnce({ type: 'create_task', success: true });
    const actionsService = { execute } as unknown as WorkflowActionsService;

    const engine = new WorkflowEngineService(repository, actionsService);

    await expect(
      engine.handleEvent('org-1', 'lead.created', {}, 'lead.created:lead-1'),
    ).rejects.toThrow();
    // Both workflows were attempted (and logged) despite the first one's retryable failure.
    expect(execute).toHaveBeenCalledTimes(2);
    expect(recordExecution).toHaveBeenCalledTimes(2);
  });
});
