import type { CustomFieldValues } from "./custom-fields.ts";

export const CONTACT_TYPES = ["person", "company"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

// Generalized across channels rather than WhatsApp-specific, per
// docs/architecture/integrations-platform.md §5 — a contact's opt-in history is the same shape
// regardless of which channel it's for. `source` is a short free-text description of how consent
// was obtained (e.g. "onboarding form", "storefront checkout checkbox") — Meta expects a business
// to be able to demonstrate how and when consent was granted, not just a boolean.
export const CONSENT_CHANNELS = ["whatsapp", "email", "sms"] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

export interface ContactConsent {
  channel: ConsentChannel;
  grantedAt: string;
  source: string;
  revokedAt?: string;
}

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
  consents: ContactConsent[];
  /** Pre-fills TimeEntry.hourlyRate when a time entry is logged for this client without an
   *  explicit rate — see TimeEntriesService.create's resolution order (this contact's rate takes
   *  priority over the staff member's own default). Denominated in the organization's currency. */
  defaultHourlyRate?: number;
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
