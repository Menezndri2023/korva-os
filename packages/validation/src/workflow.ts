import { z } from "zod";
import { SYSTEM_EVENTS, WORKFLOW_CONDITION_OPERATORS } from "@korva/types";

export const workflowConditionInputSchema = z.object({
  field: z.string().min(1).max(200),
  operator: z.enum(WORKFLOW_CONDITION_OPERATORS),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const createTaskConfigSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
});
const sendEmailConfigSchema = z.object({
  to: z.string().min(1).max(300),
  subject: z.string().min(1).max(300),
  body: z.string().min(1).max(5000),
});
const webhookConfigSchema = z.object({
  url: z.string().url(),
});

export const workflowActionInputSchema = z.union([
  z.object({ type: z.literal("create_task"), config: createTaskConfigSchema }),
  z.object({ type: z.literal("send_email"), config: sendEmailConfigSchema }),
  z.object({ type: z.literal("webhook"), config: webhookConfigSchema }),
]);

export const createWorkflowSchema = z.object({
  name: z.string().min(1).max(200),
  trigger: z.enum(SYSTEM_EVENTS),
  active: z.boolean().default(true),
  conditions: z.array(workflowConditionInputSchema).default([]),
  actions: z.array(workflowActionInputSchema).min(1),
});
export type CreateWorkflowInput = z.infer<typeof createWorkflowSchema>;

export const updateWorkflowSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  active: z.boolean().optional(),
  conditions: z.array(workflowConditionInputSchema).optional(),
  actions: z.array(workflowActionInputSchema).min(1).optional(),
});
export type UpdateWorkflowInput = z.infer<typeof updateWorkflowSchema>;

export const testWorkflowSchema = z.object({
  payload: z.record(z.string(), z.unknown()).default({}),
});
export type TestWorkflowInput = z.infer<typeof testWorkflowSchema>;
