import type { CustomFieldValues } from "./custom-fields.ts";

export const CONTACT_TYPES = ["person", "company"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export interface Contact {
  id: string;
  organizationId: string;
  type: ContactType;
  firstName?: string;
  lastName?: string;
  company?: string;
  email?: string;
  phone?: string;
  tags: string[];
  customFields: CustomFieldValues;
  createdAt: string;
  updatedAt: string;
}

export const LEAD_STATUSES = ["open", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface Lead {
  id: string;
  organizationId: string;
  contactId: string;
  source?: string;
  pipelineId: string;
  stageId: string;
  ownerId?: string;
  status: LeadStatus;
  estimatedValue?: number;
  probability?: number;
  customFields: CustomFieldValues;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineStage {
  id: string;
  name: string;
  order: number;
  probability?: number;
}

export interface Pipeline {
  id: string;
  organizationId: string;
  name: string;
  isDefault: boolean;
  stages: PipelineStage[];
  createdAt: string;
  updatedAt: string;
}

export const ACTIVITY_TYPES = ["call", "email", "meeting", "note", "status_change", "other"] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export interface Activity {
  id: string;
  organizationId: string;
  entity: "contact" | "lead";
  entityId: string;
  type: ActivityType;
  content?: string;
  authorId?: string;
  createdAt: string;
}

export const TASK_STATUSES = ["pending", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Task {
  id: string;
  organizationId: string;
  title: string;
  description?: string;
  entity?: "contact" | "lead";
  entityId?: string;
  assigneeId?: string;
  dueAt?: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  organizationId: string;
  entity: "contact" | "lead";
  entityId: string;
  content: string;
  authorId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Tag {
  id: string;
  organizationId: string;
  name: string;
  color?: string;
}
