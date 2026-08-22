/**
 * System events emitted by business actions across modules (see docs/architecture.md
 * "Event Bus"). Not exhaustive by design — new modules add their own event names here
 * as they're built. quote.expired and invoice.overdue are defined as valid trigger
 * names but are not yet emitted anywhere (no scheduler/cron built yet — see
 * docs/architecture-decisions.md).
 */
export const SYSTEM_EVENTS = [
  "lead.created",
  "quote.created",
  "quote.accepted",
  "quote.expired",
  "order.created",
  "payment.completed",
  "booking.created",
  "booking.cancelled",
  "customer.created",
  "invoice.overdue",
] as const;
export type SystemEvent = (typeof SYSTEM_EVENTS)[number];

export const WORKFLOW_CONDITION_OPERATORS = [
  "equals",
  "not_equals",
  "greater_than",
  "less_than",
  "contains",
] as const;
export type WorkflowConditionOperator = (typeof WORKFLOW_CONDITION_OPERATORS)[number];

export interface WorkflowCondition {
  /** Dot-path into the event payload, e.g. "amount" or "contact.email". */
  field: string;
  operator: WorkflowConditionOperator;
  value: string | number | boolean;
}

export const WORKFLOW_ACTION_TYPES = [
  "create_task",
  "send_email",
  "webhook",
  "internal_notification",
] as const;
export type WorkflowActionType = (typeof WORKFLOW_ACTION_TYPES)[number];

export interface CreateTaskActionConfig {
  title: string;
  description?: string;
}
export interface SendEmailActionConfig {
  to: string;
  subject: string;
  body: string;
}
export interface WebhookActionConfig {
  url: string;
}
/** Broadcasts a Notification to every active member of the organization (see Communication module). */
export interface InternalNotificationActionConfig {
  title: string;
  body?: string;
}

export type WorkflowAction =
  | { type: "create_task"; config: CreateTaskActionConfig }
  | { type: "send_email"; config: SendEmailActionConfig }
  | { type: "webhook"; config: WebhookActionConfig }
  | { type: "internal_notification"; config: InternalNotificationActionConfig };

export interface Workflow {
  id: string;
  organizationId: string;
  name: string;
  trigger: string;
  active: boolean;
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  createdAt: string;
  updatedAt: string;
}

export const WORKFLOW_EXECUTION_STATUSES = ["success", "failed"] as const;
export type WorkflowExecutionStatus = (typeof WORKFLOW_EXECUTION_STATUSES)[number];

export interface WorkflowActionResult {
  type: WorkflowActionType;
  success: boolean;
  error?: string;
  /**
   * True only for a genuine execution failure of create_task/internal_notification — the two
   * action types whose claim-first guard makes a BullMQ job retry safe. Never set for
   * send_email/webhook: their own failure must never trigger an automatic retry, since neither
   * has a way to guarantee the external side effect wasn't already delivered.
   */
  retryable?: boolean;
}

export interface WorkflowExecution {
  id: string;
  organizationId: string;
  workflowId: string;
  eventName: string;
  payload: Record<string, unknown>;
  status: WorkflowExecutionStatus;
  actionResults: WorkflowActionResult[];
  error?: string;
  createdAt: string;
}
