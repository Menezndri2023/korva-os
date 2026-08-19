/** Queue names shared between apps/api (producer) and apps/worker (consumer). */
export const QUEUE_NAMES = {
  EMAIL: "email",
  NOTIFICATIONS: "notifications",
  PDF: "pdf-generation",
  WORKFLOWS: "workflows",
  AI_TASKS: "ai-tasks",
  REMINDERS: "reminders",
  WEBHOOKS: "webhooks",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
