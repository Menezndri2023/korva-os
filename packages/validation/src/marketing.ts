import { z } from "zod";
import { SEGMENT_MATCH_MODES, SEGMENT_RULE_OPERATORS } from "@korva/types";

// `value` is deliberately a primitive union, never z.any()/z.record() — see SegmentRule's own
// doc comment in @korva/types for why (Mongo operator-injection risk).
const segmentRuleSchema = z.object({
  field: z.string().min(1),
  operator: z.enum(SEGMENT_RULE_OPERATORS),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

const segmentCriteriaSchema = z.object({
  version: z.literal(1),
  match: z.enum(SEGMENT_MATCH_MODES),
  rules: z.array(segmentRuleSchema).min(1),
});

export const createSegmentSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
  criteria: segmentCriteriaSchema,
});
export type CreateSegmentInput = z.infer<typeof createSegmentSchema>;

export const updateSegmentSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  criteria: segmentCriteriaSchema.optional(),
});
export type UpdateSegmentInput = z.infer<typeof updateSegmentSchema>;

export const previewSegmentSchema = z.object({
  criteria: segmentCriteriaSchema,
});
export type PreviewSegmentInput = z.infer<typeof previewSegmentSchema>;

export const listSegmentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListSegmentsQuery = z.infer<typeof listSegmentsQuerySchema>;

export const createCampaignSchema = z.object({
  name: z.string().min(1).max(120),
  segmentId: z.string().min(1),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(5000),
});
export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;

export const updateCampaignSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  segmentId: z.string().min(1).optional(),
  subject: z.string().max(200).optional(),
  body: z.string().min(1).max(5000).optional(),
});
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;

export const listCampaignsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListCampaignsQuery = z.infer<typeof listCampaignsQuerySchema>;

export const listCampaignRecipientsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListCampaignRecipientsQuery = z.infer<
  typeof listCampaignRecipientsQuerySchema
>;
