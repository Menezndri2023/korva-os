/** Redis/BullMQ queue that carries system events from publishers to the WorkflowEngine. */
export const EVENTS_QUEUE_NAME = 'events';

export interface EventJobData {
  organizationId: string;
  name: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}
