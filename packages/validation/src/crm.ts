import { z } from "zod";
import {
  CONTACT_TYPES,
  LEAD_STATUSES,
  DEAL_STATUSES,
  TASK_STATUSES,
  TASK_ENTITIES,
  ACTIVITY_TYPES,
} from "@korva/types";

const customFieldsSchema = z.record(z.string(), z.unknown()).optional();

export const createContactSchema = z.object({
  type: z.enum(CONTACT_TYPES).default("person"),
  firstName: z.string().min(1).max(120).optional(),
  lastName: z.string().min(1).max(120).optional(),
  company: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(1).max(40).optional(),
  tags: z.array(z.string().min(1).max(60)).default([]),
  customFields: customFieldsSchema,
  defaultHourlyRate: z.number().positive().optional(),
});
export type CreateContactInput = z.infer<typeof createContactSchema>;

export const updateContactSchema = createContactSchema.partial();
export type UpdateContactInput = z.infer<typeof updateContactSchema>;

export const mergeContactsSchema = z.object({
  duplicateContactId: z.string().min(1),
});
export type MergeContactsInput = z.infer<typeof mergeContactsSchema>;

export const listContactsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  tag: z.string().optional(),
});
export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>;

export const createLeadSchema = z.object({
  contactId: z.string().min(1),
  source: z.string().max(120).optional(),
  ownerId: z.string().optional(),
  customFields: customFieldsSchema,
});
export type CreateLeadInput = z.infer<typeof createLeadSchema>;

export const updateLeadSchema = z.object({
  source: z.string().max(120).optional(),
  ownerId: z.string().optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  customFields: customFieldsSchema,
});
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;

export const listLeadsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(LEAD_STATUSES).optional(),
  ownerId: z.string().optional(),
  contactId: z.string().optional(),
});
export type ListLeadsQuery = z.infer<typeof listLeadsQuerySchema>;

export const convertLeadSchema = z.object({
  pipelineId: z.string().min(1),
  stageId: z.string().min(1),
  estimatedValue: z.number().nonnegative().optional(),
  probability: z.number().min(0).max(100).optional(),
});
export type ConvertLeadInput = z.infer<typeof convertLeadSchema>;

export const createDealSchema = z.object({
  contactId: z.string().min(1),
  pipelineId: z.string().min(1),
  stageId: z.string().min(1),
  ownerId: z.string().optional(),
  estimatedValue: z.number().nonnegative().optional(),
  probability: z.number().min(0).max(100).optional(),
  customFields: customFieldsSchema,
});
export type CreateDealInput = z.infer<typeof createDealSchema>;

export const updateDealSchema = z.object({
  ownerId: z.string().optional(),
  estimatedValue: z.number().nonnegative().optional(),
  probability: z.number().min(0).max(100).optional(),
  customFields: customFieldsSchema,
});
export type UpdateDealInput = z.infer<typeof updateDealSchema>;

export const moveDealStageSchema = z.object({
  stageId: z.string().min(1),
});
export type MoveDealStageInput = z.infer<typeof moveDealStageSchema>;

export const loseDealSchema = z.object({
  lossReason: z.string().max(500).optional(),
});
export type LoseDealInput = z.infer<typeof loseDealSchema>;

export const listDealsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  pipelineId: z.string().optional(),
  stageId: z.string().optional(),
  status: z.enum(DEAL_STATUSES).optional(),
  ownerId: z.string().optional(),
  contactId: z.string().optional(),
  leadId: z.string().optional(),
});
export type ListDealsQuery = z.infer<typeof listDealsQuerySchema>;

export const pipelineStageInputSchema = z.object({
  name: z.string().min(1).max(80),
  order: z.number().int().min(0),
  probability: z.number().min(0).max(100).optional(),
});

export const createPipelineSchema = z.object({
  name: z.string().min(1).max(120),
  isDefault: z.boolean().default(false),
  stages: z.array(pipelineStageInputSchema).min(1),
});
export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;

export const updatePipelineSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  isDefault: z.boolean().optional(),
  stages: z.array(pipelineStageInputSchema).min(1).optional(),
});
export type UpdatePipelineInput = z.infer<typeof updatePipelineSchema>;

export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  entity: z.enum(TASK_ENTITIES).optional(),
  entityId: z.string().optional(),
  assigneeId: z.string().optional(),
  dueAt: z.string().datetime().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  assigneeId: z.string().optional(),
  dueAt: z.string().datetime().optional(),
  status: z.enum(TASK_STATUSES).optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const createNoteSchema = z.object({
  entity: z.enum(["contact", "lead", "deal"]),
  entityId: z.string().min(1),
  content: z.string().min(1).max(5000),
});
export type CreateNoteInput = z.infer<typeof createNoteSchema>;

export const createActivitySchema = z.object({
  entity: z.enum(["contact", "lead", "deal"]),
  entityId: z.string().min(1),
  type: z.enum(ACTIVITY_TYPES),
  content: z.string().max(2000).optional(),
});
export type CreateActivityInput = z.infer<typeof createActivitySchema>;

export const listRecentActivitiesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListRecentActivitiesQuery = z.infer<
  typeof listRecentActivitiesQuerySchema
>;

export const createTagSchema = z.object({
  name: z.string().min(1).max(60),
  color: z.string().max(20).optional(),
});
export type CreateTagInput = z.infer<typeof createTagSchema>;
