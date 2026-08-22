import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Types } from 'mongoose';
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
import { safeFetch } from '../shared/safe-fetch';
import { WorkflowsRepository } from './workflows.repository';

/** Identifies exactly one action within one workflow's run of one event — see WorkflowActionClaim. */
export interface WorkflowActionClaimContext {
  workflowId: Types.ObjectId;
  actionIndex: number;
  eventKey: string;
}

/**
 * create_task/internal_notification are pure internal writes with no external counterparty to
 * disagree with us about whether they already happened — a claim fully covers them, so their own
 * failure is safe to propagate as a retryable job failure. send_email/webhook talk to a system
 * this codebase doesn't control; a claim protects them from being replayed by a retry that was
 * actually triggered by a *different* action's failure, but it can never prove the external side
 * effect wasn't already delivered right before a crash/timeout — so their own failure must never
 * be marked retryable (see docs/lot-q audit §13).
 */
const RETRYABLE_ACTION_TYPES: ReadonlySet<WorkflowAction['type']> = new Set([
  'create_task',
  'internal_notification',
]);

@Injectable()
export class WorkflowActionsService {
  private readonly logger = new Logger(WorkflowActionsService.name);

  constructor(
    private readonly tasksService: TasksService,
    private readonly notificationsService: NotificationsService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    private readonly workflowsRepository: WorkflowsRepository,
  ) {}

  async execute(
    organizationId: string,
    action: WorkflowAction,
    payload: Record<string, unknown>,
    claim?: WorkflowActionClaimContext,
  ): Promise<WorkflowActionResult> {
    if (claim) {
      const claimResult = await this.workflowsRepository.claimAction(
        organizationId,
        claim.workflowId,
        claim.actionIndex,
        claim.eventKey,
      );
      // Someone (a prior attempt, or a concurrent one) already has this covered — running the
      // effect again is exactly the double-execution this claim exists to prevent.
      if (claimResult !== 'claimed') {
        return { type: action.type, success: true };
      }
    }

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
      if (claim) {
        await this.workflowsRepository.markActionSucceeded(
          organizationId,
          claim.workflowId,
          claim.actionIndex,
          claim.eventKey,
        );
      }
      return { type: action.type, success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Workflow action "${action.type}" failed: ${message}`);
      // No claim (eventKey wasn't derivable for this event) means no dedup guard exists at all
      // — retrying would be unprotected even for create_task/internal_notification, so it's
      // never marked retryable in that case regardless of action type.
      const retryable = !!claim && RETRYABLE_ACTION_TYPES.has(action.type);
      return { type: action.type, success: false, error: message, retryable };
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
      to: interpolate(config.to, payload, { escapeHtml: true }),
      subject: interpolate(config.subject, payload, { escapeHtml: true }),
      body: interpolate(config.body, payload, { escapeHtml: true }),
    });
    if (result.status === 'failed') {
      throw new Error(`Email provider failed to send the workflow email`);
    }
  }

  private async callWebhook(
    config: WebhookActionConfig,
    payload: Record<string, unknown>,
  ): Promise<void> {
    // safeFetch validates config.url (and every redirect hop) against internal/private/
    // reserved addresses before making any request — see shared/safe-fetch.ts. Never call
    // fetch() directly here with a user-supplied URL.
    const response = await safeFetch(config.url, {
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
