export const SEGMENT_RULE_OPERATORS = [
  "has_tag",
  "not_has_tag",
  "equals",
  "not_equals",
  "contains",
  "is_set",
  "is_not_set",
] as const;
export type SegmentRuleOperator = (typeof SEGMENT_RULE_OPERATORS)[number];

/**
 * `field` is either the literal "tag" or "customField:<key>" — a small, versioned DSL rather
 * than a raw Mongo FilterQuery, so a future v2 engine (nested groups, more operators) can add a
 * new interpreter branch without migrating already-saved Segments. `value` is deliberately a
 * primitive only (never object/array): accepting an arbitrary object as a Mongo filter value is
 * the classic operator-injection bug (e.g. `{$gt: ""}` silently turning an equality check into
 * "field exists and is truthy") — see segment-query-builder.ts, the one place this DSL is
 * actually interpreted.
 */
export interface SegmentRule {
  field: string;
  operator: SegmentRuleOperator;
  value?: string | number | boolean;
}

export const SEGMENT_MATCH_MODES = ["all", "any"] as const;
export type SegmentMatchMode = (typeof SEGMENT_MATCH_MODES)[number];

export interface SegmentCriteria {
  version: 1;
  match: SegmentMatchMode;
  rules: SegmentRule[];
}

export interface Segment {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  criteria: SegmentCriteria;
  createdAt: string;
  updatedAt: string;
}

export const CAMPAIGN_STATUSES = ["draft", "sending", "sent"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_RECIPIENT_STATUSES = [
  "pending",
  "sent",
  "failed",
  "skipped",
] as const;
export type CampaignRecipientStatus =
  (typeof CAMPAIGN_RECIPIENT_STATUSES)[number];

export interface CampaignStats {
  totalRecipients: number;
  processedCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
}

/**
 * `body`/`subject` are freeform strings with `{{contact.x}}` placeholders (see
 * apps/api/src/shared/template.ts#interpolate) — deliberately NOT a MessageTemplate reference:
 * MessageTemplate.channel is fixed to one channel, but a campaign send fans out via
 * sendWithChannelFallback (whatsapp-then-email per contact), so no single channel-bound template
 * fits every recipient.
 */
export interface Campaign {
  id: string;
  organizationId: string;
  name: string;
  segmentId: string;
  subject?: string;
  body: string;
  status: CampaignStatus;
  stats: CampaignStats;
  launchedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignRecipient {
  id: string;
  organizationId: string;
  campaignId: string;
  contactId: string;
  status: CampaignRecipientStatus;
  channelUsed?: "whatsapp" | "email";
  error?: string;
  sentAt?: string;
  createdAt: string;
  updatedAt: string;
}
