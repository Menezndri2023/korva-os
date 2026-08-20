import { Injectable, Logger } from '@nestjs/common';
import type {
  CreateTaskActionConfig,
  SendEmailActionConfig,
  WebhookActionConfig,
  WorkflowAction,
  WorkflowActionResult,
} from '@korva/types';
import { TasksService } from '../crm/tasks/tasks.service';
import { interpolate } from './template';

@Injectable()
export class WorkflowActionsService {
  private readonly logger = new Logger(WorkflowActionsService.name);

  constructor(private readonly tasksService: TasksService) {}

  async execute(
    organizationId: string,
    action: WorkflowAction,
    payload: Record<string, unknown>,
  ): Promise<WorkflowActionResult> {
    try {
      switch (action.type) {
        case 'create_task':
          await this.createTask(organizationId, action.config, payload);
          break;
        case 'send_email':
          this.sendEmail(action.config, payload);
          break;
        case 'webhook':
          await this.callWebhook(action.config, payload);
          break;
      }
      return { type: action.type, success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Workflow action "${action.type}" failed: ${message}`);
      return { type: action.type, success: false, error: message };
    }
  }

  private async createTask(
    organizationId: string,
    config: CreateTaskActionConfig,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.tasksService.create(organizationId, {
      title: interpolate(config.title, payload),
      description: config.description
        ? interpolate(config.description, payload)
        : undefined,
    });
  }

  /** No EmailProvider yet (arrives with Phase 8 Communication) — logs only, architecture-ready. */
  private sendEmail(
    config: SendEmailActionConfig,
    payload: Record<string, unknown>,
  ): void {
    this.logger.log(
      `[send_email stub] to=${interpolate(config.to, payload)} subject="${interpolate(config.subject, payload)}"`,
    );
  }

  private async callWebhook(
    config: WebhookActionConfig,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const response = await fetch(config.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`Webhook responded with status ${response.status}`);
    }
  }
}
