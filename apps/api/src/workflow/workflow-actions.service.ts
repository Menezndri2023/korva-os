import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  CreateTaskActionConfig,
  InternalNotificationActionConfig,
  SendEmailActionConfig,
  WebhookActionConfig,
  WorkflowAction,
  WorkflowActionResult,
} from '@korva/types';
import { TasksService } from '../crm/tasks/tasks.service';
import { NotificationsService } from '../communication/notifications/notifications.service';
import {
  EMAIL_PROVIDER,
  type EmailProvider,
} from '../communication/providers/email-provider.interface';
import { interpolate } from '../shared/template';

@Injectable()
export class WorkflowActionsService {
  private readonly logger = new Logger(WorkflowActionsService.name);

  constructor(
    private readonly tasksService: TasksService,
    private readonly notificationsService: NotificationsService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

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
          await this.sendEmail(action.config, payload);
          break;
        case 'webhook':
          await this.callWebhook(action.config, payload);
          break;
        case 'internal_notification':
          await this.notifyOrganization(organizationId, action.config, payload);
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

  private async sendEmail(
    config: SendEmailActionConfig,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const result = await this.emailProvider.send({
      to: interpolate(config.to, payload),
      subject: interpolate(config.subject, payload),
      body: interpolate(config.body, payload),
    });
    if (result.status === 'failed') {
      throw new Error(`Email provider failed to send the workflow email`);
    }
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

  private async notifyOrganization(
    organizationId: string,
    config: InternalNotificationActionConfig,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.notificationsService.notifyOrganization(organizationId, {
      type: 'workflow',
      title: interpolate(config.title, payload),
      body: config.body ? interpolate(config.body, payload) : undefined,
    });
  }
}
